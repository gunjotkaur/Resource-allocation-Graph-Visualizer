/**
 * ═══════════════════════════════════════════════════════════════
 * RAG Visualizer — script.js
 *
 * Modules:
 *   ThemeManager    — switch between 5 CSS themes, re-color vis nodes
 *   GraphManager    — vis.Network wrapper (add/connect/highlight nodes)
 *   DeadlockEngine  — iterative DFS cycle detection + cycle tracing
 *   AnalysisPanel   — builds rich HTML analysis (why, coffman, resolution)
 *   UIController    — mode indicator, status pill, banner, toast
 * ═══════════════════════════════════════════════════════════════
 */
"use strict";

/* ══════════════════════════════════════════════════════════════
   THEME DEFINITIONS  (mirrors CSS variables)
══════════════════════════════════════════════════════════════ */
const THEMES = {
  dark: {
    process: "#00ff88",
    resource: "#00d2ff",
    req: "#ff9f1c",
    alloc: "#00d2ff",
    cycle: "#ff3d6b",
    shadow: "rgba(0,0,0,0.6)",
    bg: "#0a0c10",
  },
  light: {
    process: "#059669",
    resource: "#2563eb",
    req: "#d97706",
    alloc: "#2563eb",
    cycle: "#dc2626",
    shadow: "rgba(0,0,0,0.15)",
    bg: "#f7f8fc",
  },
  cyberpunk: {
    process: "#00ffcc",
    resource: "#ff00ff",
    req: "#ffee00",
    alloc: "#ff00ff",
    cycle: "#ff0055",
    shadow: "rgba(255,0,255,0.2)",
    bg: "#0d0015",
  },
  matrix: {
    process: "#00ff41",
    resource: "#00cc33",
    req: "#88ff00",
    alloc: "#00cc33",
    cycle: "#ff4141",
    shadow: "rgba(0,255,65,0.15)",
    bg: "#000d00",
  },
  ocean: {
    process: "#34d399",
    resource: "#38bdf8",
    req: "#fb923c",
    alloc: "#38bdf8",
    cycle: "#f87171",
    shadow: "rgba(0,0,0,0.7)",
    bg: "#020b18",
  },
};

let currentTheme = "dark";

/* ══════════════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════════════ */
const state = {
  mode: "none",
  processCount: 0,
  resourceCount: 0,
  connectSource: null,
  network: null,
  nodesDS: null,
  edgesDS: null,
};

/* ══════════════════════════════════════════════════════════════
   THEME MANAGER
══════════════════════════════════════════════════════════════ */
const ThemeManager = {
  apply(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute("data-theme", theme);

    // Toggle active pill
    document.querySelectorAll(".theme-pill").forEach((p) => {
      p.classList.toggle("active", p.dataset.theme === theme);
    });

    // Re-colour existing vis nodes and edges to match new theme palette
    if (state.nodesDS) {
      const T = THEMES[theme];
      const nodeUpdates = state.nodesDS.get().map((n) => {
        const isProcess = n.nodeType === "process";
        const c = isProcess ? T.process : T.resource;
        return {
          id: n.id,
          color: {
            background: hexToRgba(c, 0.12),
            border: c,
            highlight: { background: hexToRgba(c, 0.25), border: c },
            hover: { background: hexToRgba(c, 0.25), border: c },
          },
          font: { color: c, face: "Orbitron", size: 13, bold: true },
        };
      });
      state.nodesDS.update(nodeUpdates);

      const edgeUpdates = state.edgesDS.get().map((e) => {
        const clr = e.edgeType === "req" ? T.req : T.alloc;
        return { id: e.id, color: { color: clr, highlight: clr, hover: clr } };
      });
      state.edgesDS.update(edgeUpdates);
    }

    showToast(`Theme: ${theme}`);
  },
};

/** Helper: hex "#rrggbb" + alpha → "rgba(r,g,b,a)" */
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* Public wrapper called from HTML */
function switchTheme(t) {
  ThemeManager.apply(t);
}

/* ══════════════════════════════════════════════════════════════
   GRAPH MANAGER
══════════════════════════════════════════════════════════════ */
const GraphManager = {
  init() {
    state.nodesDS = new vis.DataSet([]);
    state.edgesDS = new vis.DataSet([]);

    const options = {
      physics: {
        enabled: true,
        solver: "forceAtlas2Based",
        forceAtlas2Based: {
          gravitationalConstant: -60,
          centralGravity: 0.01,
          springLength: 130,
          springConstant: 0.05,
          damping: 0.6,
        },
        stabilization: { iterations: 150, fit: true },
      },
      interaction: {
        hover: true,
        tooltipDelay: 180,
        zoomView: true,
        dragView: true,
        multiselect: false,
        selectConnectedEdges: false,
      },
      edges: {
        arrows: { to: { enabled: true, scaleFactor: 0.9 } },
        smooth: { type: "curvedCW", roundness: 0.2 },
        width: 2,
        hoverWidth: 3,
        selectionWidth: 3,
        font: { face: "Space Mono", size: 10, color: "#6b7280" },
      },
      nodes: {
        font: { face: "Orbitron", size: 13, bold: true },
        borderWidth: 2,
        borderWidthSelected: 3,
        shadow: { enabled: true, size: 10, color: THEMES[currentTheme].shadow },
        chosen: {
          node: (v, id, sel, hov) => {
            if (hov) {
              v.shadowSize = 20;
              v.borderWidth = 3;
            }
          },
        },
      },
    };

    state.network = new vis.Network(
      document.getElementById("ragCanvas"),
      { nodes: state.nodesDS, edges: state.edgesDS },
      options,
    );

    state.network.on("click", (p) => this.handleClick(p));
  },

  handleClick(params) {
    const nodeId = params.nodes.length > 0 ? params.nodes[0] : null;
    const edgeId = params.edges.length > 0 ? params.edges[0] : null;

    switch (state.mode) {
      case "process":
        if (!nodeId) this.addProcessNode(params.pointer.canvas);
        break;

      case "resource":
        if (!nodeId) this.addResourceNode(params.pointer.canvas);
        break;

      case "connect":
        this.handleConnectClick(nodeId);
        break;

      case "removeProcess":
        if (nodeId) this.removeProcess(nodeId);
        break;

      case "removeResource":
        if (nodeId) this.removeResource(nodeId);
        break;

      case "disconnect":
        if (edgeId) this.removeEdge(edgeId);
        break;
    }
  },

  _makeNodeColors(hex) {
    return {
      background: hexToRgba(hex, 0.12),
      border: hex,
      highlight: { background: hexToRgba(hex, 0.25), border: hex },
      hover: { background: hexToRgba(hex, 0.25), border: hex },
    };
  },

  addProcessNode({ x, y }) {
    state.processCount++;
    const id = `P${state.processCount}`;
    const T = THEMES[currentTheme];
    state.nodesDS.add({
      id,
      label: id,
      x,
      y,
      shape: "ellipse",
      color: this._makeNodeColors(T.process),
      font: { color: T.process, face: "Orbitron", size: 13, bold: true },
      widthConstraint: { minimum: 52, maximum: 52 },
      heightConstraint: { minimum: 52, maximum: 52 },
      nodeType: "process",
      title: `Process ${id}`,
    });
    updateStats();
    showToast(`Process ${id} added`);
    clearResults();
  },

  addResourceNode({ x, y }) {
    state.resourceCount++;
    const id = `R${state.resourceCount}`;
    const T = THEMES[currentTheme];
    state.nodesDS.add({
      id,
      label: id,
      x,
      y,
      shape: "box",
      color: this._makeNodeColors(T.resource),
      font: { color: T.resource, face: "Orbitron", size: 13, bold: true },
      widthConstraint: { minimum: 56, maximum: 56 },
      heightConstraint: { minimum: 56, maximum: 56 },
      nodeType: "resource",
      title: `Resource ${id}`,
    });
    updateStats();
    showToast(`Resource ${id} added`);
    clearResults();
  },

  handleConnectClick(nodeId) {
    if (!nodeId) {
      if (state.connectSource) {
        state.connectSource = null;
        UIController.updateEdgeHint("Click source node…");
      }
      return;
    }
    if (!state.connectSource) {
      state.connectSource = nodeId;
      state.network.selectNodes([nodeId]);
      UIController.updateEdgeHint(`Source: ${nodeId} — now click target`);
    } else {
      const src = state.connectSource,
        tgt = nodeId;
      state.connectSource = null;
      state.network.unselectAll();
      if (src === tgt) {
        showToast("Self-loops not allowed ✕", "error");
        UIController.updateEdgeHint("Click source node…");
        return;
      }
      if (state.edgesDS.get().some((e) => e.from === src && e.to === tgt)) {
        showToast("Edge already exists ✕", "error");
        UIController.updateEdgeHint("Click source node…");
        return;
      }
      const srcNode = state.nodesDS.get(src);
      const edgeType = srcNode.nodeType === "process" ? "req" : "alloc";
      const T = THEMES[currentTheme];
      const clr = edgeType === "req" ? T.req : T.alloc;
      state.edgesDS.add({
        from: src,
        to: tgt,
        label: edgeType,
        edgeType,
        color: { color: clr, highlight: clr, hover: clr },
        width: 2,
      });
      updateStats();
      showToast(`Edge ${src}→${tgt} (${edgeType})`);
      clearResults();
      UIController.updateEdgeHint("Click source node…");
    }
  },

  highlightCycle(cycleNodes, cycleEdgeIds) {
    const T = THEMES[currentTheme];
    state.nodesDS.update(
      cycleNodes.map((id) => ({
        id,
        color: {
          background: hexToRgba(T.cycle, 0.22),
          border: T.cycle,
          highlight: { background: hexToRgba(T.cycle, 0.35), border: T.cycle },
          hover: { background: hexToRgba(T.cycle, 0.35), border: T.cycle },
        },
        font: { color: T.cycle, face: "Orbitron", size: 13, bold: true },
        shadow: { enabled: true, size: 20, color: hexToRgba(T.cycle, 0.5) },
      })),
    );
    state.edgesDS.update(
      cycleEdgeIds.map((id) => ({
        id,
        color: { color: T.cycle, highlight: T.cycle, hover: T.cycle },
        width: 3,
        dashes: [8, 4],
      })),
    );
  },

  resetHighlights() {
    const T = THEMES[currentTheme];
    state.nodesDS.update(
      state.nodesDS.get().map((n) => {
        const c = n.nodeType === "process" ? T.process : T.resource;
        return {
          id: n.id,
          color: this._makeNodeColors(c),
          font: { color: c, face: "Orbitron", size: 13, bold: true },
          shadow: { enabled: true, size: 10, color: T.shadow },
        };
      }),
    );
    state.edgesDS.update(
      state.edgesDS.get().map((e) => {
        const clr = e.edgeType === "req" ? T.req : T.alloc;
        return {
          id: e.id,
          color: { color: clr, highlight: clr, hover: clr },
          width: 2,
          dashes: false,
        };
      }),
    );
  },

  reset() {
    state.nodesDS.clear();
    state.edgesDS.clear();
    state.processCount = 0;
    state.resourceCount = 0;
    state.connectSource = null;
    updateStats();
    clearResults();
    setMode("none");
  },

  removeProcess(nodeId) {
    const node = state.nodesDS.get(nodeId);

    if (node && node.nodeType === "process") {
      state.nodesDS.remove(nodeId);
      showToast(`${nodeId} removed`);
      updateStats();
      clearResults();
    }
  },

  removeResource(nodeId) {
    const node = state.nodesDS.get(nodeId);

    if (node && node.nodeType === "resource") {
      state.nodesDS.remove(nodeId);
      showToast(`${nodeId} removed`);
      updateStats();
      clearResults();
    }
  },

  removeEdge(edgeId) {
    state.edgesDS.remove(edgeId);
    showToast(`Connection removed`);
    updateStats();
    clearResults();
  },
};

/* ══════════════════════════════════════════════════════════════
   DEADLOCK ENGINE  — iterative DFS + cycle tracing
══════════════════════════════════════════════════════════════ */
const DeadlockEngine = {
  detect() {
    const nodes = state.nodesDS.getIds();
    const edges = state.edgesDS.get();
    if (!nodes.length) return { hasCycle: false };

    // Build adjacency list
    const adj = {};
    nodes.forEach((n) => {
      adj[n] = [];
    });
    edges.forEach((e) => {
      if (adj[e.from]) adj[e.from].push({ to: e.to, edgeId: e.id });
    });

    const visited = {},
      recStack = {},
      parent = {};
    let cycleStart = null,
      cycleEnd = null;

    const dfs = (start) => {
      const stack = [{ node: start, edgeIdx: 0, fromNode: null, edgeId: null }];
      recStack[start] = true;
      parent[start] = null;

      while (stack.length) {
        const top = stack[stack.length - 1];
        const { node } = top;

        if (top.edgeIdx === 0 && top.fromNode !== null) {
          parent[node] = { from: top.fromNode, edgeId: top.edgeId };
          recStack[node] = true;
        }

        let foundNext = false;
        const nbrs = adj[node];

        while (top.edgeIdx < nbrs.length) {
          const { to, edgeId } = nbrs[top.edgeIdx++];
          if (recStack[to]) {
            cycleStart = to;
            cycleEnd = node;
            parent["__back__"] = { from: node, to, edgeId };
            return true;
          }
          if (!visited[to]) {
            stack.push({ node: to, edgeIdx: 0, fromNode: node, edgeId });
            foundNext = true;
            break;
          }
        }

        if (!foundNext) {
          visited[node] = true;
          recStack[node] = false;
          stack.pop();
        }
      }
      return false;
    };

    for (const node of nodes) {
      if (!visited[node]) {
        recStack[node] = true;
        parent[node] = null;
        if (dfs(node))
          return this.traceCycle(cycleStart, cycleEnd, parent, edges);
        recStack[node] = false;
        visited[node] = true;
      }
    }
    return { hasCycle: false };
  },

  traceCycle(cycleStart, cycleEnd, parent, edges) {
    const cycleNodes = [cycleEnd],
      cycleEdges = [];
    const backEdge = parent["__back__"];
    if (backEdge) cycleEdges.push(backEdge.edgeId);

    let cur = cycleEnd,
      iter = 0;
    while (cur !== cycleStart && iter++ < 200) {
      const p = parent[cur];
      if (!p) break;
      cycleEdges.push(p.edgeId);
      cur = p.from;
      cycleNodes.push(cur);
    }
    if (!cycleNodes.includes(cycleStart)) cycleNodes.push(cycleStart);

    return {
      hasCycle: true,
      cycleNodes: [...new Set(cycleNodes)],
      cycleEdges: [...new Set(cycleEdges)],
    };
  },
};

/* ══════════════════════════════════════════════════════════════
   ANALYSIS PANEL  — builds the rich right-panel UI
══════════════════════════════════════════════════════════════ */
const AnalysisPanel = {
  /** Called after detection with full result object */
  render(result) {
    document.getElementById("analysisIdle").style.display = "none";
    document.getElementById("analysisResults").style.display = "block";

    if (result.hasCycle) {
      this._renderDeadlock(result);
    } else {
      this._renderSafe();
    }
  },

  hide() {
    document.getElementById("analysisIdle").style.display = "flex";
    document.getElementById("analysisResults").style.display = "none";
  },

  /* ── DEADLOCK CASE ────────────────────────────────────────── */
  _renderDeadlock(result) {
    const { cycleNodes, cycleEdges } = result;

    // Verdict
    const vb = document.getElementById("verdictBox");
    vb.className = "verdict-box vb-deadlock";
    document.getElementById("verdictEmoji").textContent = "☠️";
    document.getElementById("verdictTitle").textContent = "DEADLOCK DETECTED";
    document.getElementById("verdictTitle").style.color = "var(--red)";
    document.getElementById("verdictSubtitle").textContent =
      `A circular wait involving ${cycleNodes.length} nodes was found. ` +
      `All involved processes are permanently blocked.`;

    // Cycle path visual
    show("cycleSection");
    const cpv = document.getElementById("cyclePathVisual");
    cpv.innerHTML = "";
    const ordered = [...cycleNodes];
    ordered.forEach((id, i) => {
      const n = state.nodesDS.get(id);
      const chip = el(
        "span",
        `cp-node cp-cycle ${n.nodeType === "process" ? "cp-process" : "cp-resource"}`,
        id,
      );
      cpv.appendChild(chip);
      if (i < ordered.length - 1 || true) {
        cpv.appendChild(el("span", "cp-arrow", " → "));
      }
    });
    // Close the loop
    const firstId = ordered[ordered.length - 1];
    const firstNode = state.nodesDS.get(ordered[0]);
    cpv.appendChild(
      el(
        "span",
        `cp-node cp-cycle ${firstNode.nodeType === "process" ? "cp-process" : "cp-resource"}`,
        ordered[0],
      ),
    );

    // Why section
    show("whySection");
    document.getElementById("whyBody").innerHTML =
      this._buildWhyHTML(cycleNodes);

    // Coffman conditions
    show("coffmanSection");
    document.getElementById("coffmanBody").innerHTML =
      this._buildCoffmanHTML(cycleNodes);

    // Process breakdown
    show("processSection");
    document.getElementById("processBody").innerHTML =
      this._buildProcessTable(cycleNodes);

    // Resolution
    show("resolutionSection");
    document.getElementById("resolutionBody").innerHTML =
      this._buildResolutionHTML(cycleNodes);

    hide("safeSection");
  },

  /* ── SAFE CASE ────────────────────────────────────────────── */
  _renderSafe() {
    const vb = document.getElementById("verdictBox");
    vb.className = "verdict-box vb-safe";
    document.getElementById("verdictEmoji").textContent = "✅";
    document.getElementById("verdictTitle").textContent = "NO DEADLOCK";
    document.getElementById("verdictTitle").style.color = "var(--green)";
    document.getElementById("verdictSubtitle").textContent =
      "The graph contains no circular waits. All processes can eventually complete execution.";

    hide("cycleSection");
    hide("whySection");
    hide("coffmanSection");
    hide("resolutionSection");
    show("processSection");
    document.getElementById("processBody").innerHTML = this._buildProcessTable(
      [],
    );
    show("safeSection");
    this._buildSafeSection();
  },

  /* ── WHY HTML ─────────────────────────────────────────────── */
  _buildWhyHTML(cycleNodes) {
    const edges = state.edgesDS.get();
    const processes = cycleNodes.filter(
      (id) => state.nodesDS.get(id)?.nodeType === "process",
    );
    const resources = cycleNodes.filter(
      (id) => state.nodesDS.get(id)?.nodeType === "resource",
    );

    // Find what each deadlocked process holds and waits for
    const holdings = {},
      waiting = {};
    processes.forEach((pid) => {
      holdings[pid] = [];
      waiting[pid] = [];
    });
    edges.forEach((e) => {
      if (e.edgeType === "req" && processes.includes(e.from))
        waiting[e.from].push(e.to);
      if (e.edgeType === "alloc" && processes.includes(e.to))
        holdings[e.to].push(e.from);
    });

    let html = "";

    html += card(
      "danger",
      "🔄 Circular Wait — Root Cause",
      `Processes <code>${processes.join(", ")}</code> form a circular dependency chain. ` +
        `Each process holds a resource that the next process in the chain is waiting for, ` +
        `creating an unresolvable loop. No process can proceed without releasing a resource ` +
        `it will never release (because it's blocked waiting).`,
    );

    processes.forEach((pid) => {
      const holds = holdings[pid] || [];
      const waitsF = waiting[pid] || [];
      if (holds.length && waitsF.length) {
        html += card(
          "warn",
          `⚙ ${pid}: Holding & Waiting`,
          `<code>${pid}</code> currently holds <code>${holds.join(", ")}</code> but is blocked ` +
            `waiting for <code>${waitsF.join(", ")}</code>. It will never release what it holds ` +
            `until it acquires what it's waiting for — which is held by another blocked process.`,
        );
      }
    });

    html += card(
      "",
      "🚫 No Preemption Available",
      `Resources in this graph are non-preemptable — once allocated to a process, ` +
        `they cannot be forcibly taken away. This means the OS cannot break the deadlock ` +
        `automatically without terminating a process.`,
    );

    return html;

    function card(cls, title, body) {
      return `<div class="why-card ${cls ? "why-" + cls : ""}" style="margin-bottom:6px">
        <div class="why-card-title">${title}</div>
        <div class="why-card-body">${body}</div>
      </div>`;
    }
  },

  /* ── COFFMAN CONDITIONS ───────────────────────────────────── */
  _buildCoffmanHTML(cycleNodes) {
    /*
      Coffman (1971) identified 4 necessary & sufficient conditions for deadlock.
      All 4 must hold simultaneously. We evaluate each based on graph structure.
    */
    const edges = state.edgesDS.get();
    const hasAlloc = edges.some((e) => e.edgeType === "alloc");
    const hasReq = edges.some((e) => e.edgeType === "req");
    const inCycle = cycleNodes.length > 0;

    const conditions = [
      {
        icon: "🔒",
        name: "Mutual Exclusion",
        desc: "Resources cannot be shared — each resource is held by at most one process at a time.",
        met: hasAlloc ? "YES" : "MAYBE",
        detail: hasAlloc
          ? "Allocation edges exist, confirming resources are exclusively held."
          : "No allocations found, condition may not hold.",
      },
      {
        icon: "✋",
        name: "Hold and Wait",
        desc: "A process is holding at least one resource while waiting for additional resources.",
        met: hasAlloc && hasReq ? "YES" : "NO",
        detail:
          hasAlloc && hasReq
            ? "Both request and allocation edges co-exist — processes are simultaneously holding and requesting."
            : "Either no holdings or no requests detected.",
      },
      {
        icon: "🚫",
        name: "No Preemption",
        desc: "Resources cannot be forcibly taken from a process; they must be released voluntarily.",
        met: "YES",
        detail:
          "Standard RAG model assumes non-preemptive resource allocation.",
      },
      {
        icon: "🔄",
        name: "Circular Wait",
        desc: "A circular chain of processes exists where each waits for a resource held by the next.",
        met: inCycle ? "YES" : "NO",
        detail: inCycle
          ? `Cycle detected: ${cycleNodes.join(" → ")} → ${cycleNodes[0]}`
          : "No cycle found — this condition is NOT satisfied, so no deadlock.",
      },
    ];

    return conditions
      .map((c) => {
        const badgeCls =
          c.met === "YES"
            ? "cbadge-yes"
            : c.met === "NO"
              ? "cbadge-no"
              : "cbadge-maybe";
        return `<div class="coffman-item">
        <span class="coffman-icon">${c.icon}</span>
        <div style="flex:1">
          <div class="coffman-name">${c.name}</div>
          <div class="coffman-desc">${c.desc}</div>
          <div class="coffman-desc" style="margin-top:4px;font-style:italic">${c.detail}</div>
        </div>
        <span class="coffman-badge ${badgeCls}">${c.met}</span>
      </div>`;
      })
      .join("");
  },

  /* ── PROCESS TABLE ────────────────────────────────────────── */
  _buildProcessTable(cycleNodes) {
    const nodes = state.nodesDS.get().filter((n) => n.nodeType === "process");
    const edges = state.edgesDS.get();

    if (!nodes.length)
      return `<p style="font-size:11px;color:var(--text-muted)">No processes in graph.</p>`;

    return nodes
      .map((n) => {
        const holds = edges
          .filter((e) => e.edgeType === "alloc" && e.to === n.id)
          .map((e) => e.from);
        const waitsFor = edges
          .filter((e) => e.edgeType === "req" && e.from === n.id)
          .map((e) => e.to);
        const isInCycle = cycleNodes.includes(n.id);

        return `<div class="proc-row ${isInCycle ? "proc-deadlocked" : ""}">
        <span class="proc-id ${isInCycle ? "pid-deadlocked" : ""}">${n.id}</span>
        <div class="proc-col">
          <span class="proc-col-label">Holds</span>
          <span class="proc-col-val">${holds.length ? holds.join(", ") : "—"}</span>
        </div>
        <div class="proc-col">
          <span class="proc-col-label">Waiting for</span>
          <span class="proc-col-val" style="${isInCycle ? "color:var(--red)" : ""}">${waitsFor.length ? waitsFor.join(", ") : "—"}</span>
        </div>
      </div>`;
      })
      .join("");
  },

  /* ── RESOLUTION STEPS ─────────────────────────────────────── */
  _buildResolutionHTML(cycleNodes) {
    const processes = cycleNodes.filter(
      (id) => state.nodesDS.get(id)?.nodeType === "process",
    );
    const resources = cycleNodes.filter(
      (id) => state.nodesDS.get(id)?.nodeType === "resource",
    );

    const strategies = [
      {
        title: "Process Termination",
        desc: `Terminate one or more deadlocked processes to break the cycle. The OS reclaims all resources held by the terminated process, potentially unblocking the rest.`,
        targets: processes.slice(0, 1),
        targetLabel: "Suggested target",
      },
      {
        title: "Resource Preemption",
        desc: `Forcibly take a resource from one deadlocked process and give it to another. The preempted process must be rolled back to a safe checkpoint state.`,
        targets: resources.slice(0, 1),
        targetLabel: "Preempt resource",
      },
      {
        title: "Request-Edge Removal",
        desc: `Remove a request edge from the cycle to break the circular dependency. This simulates a process voluntarily giving up its wait for a resource.`,
        targets: processes,
        targetLabel: "Remove request from",
      },
      {
        title: "Deadlock Prevention (Future)",
        desc: `Redesign the resource acquisition order so all processes request resources in the same global order (resource ordering). This eliminates the possibility of circular wait entirely.`,
        targets: [],
        targetLabel: "",
      },
    ];

    return strategies
      .map(
        (s, i) => `
      <div class="res-card">
        <span class="res-num">${i + 1}</span>
        <div style="flex:1">
          <div class="res-title">${s.title}</div>
          <div class="res-desc">${s.desc}</div>
          ${s.targets.length ? `<div class="res-target">${s.targetLabel}: ${s.targets.map((t) => `<span>${t}</span>`).join("")}</div>` : ""}
        </div>
      </div>`,
      )
      .join("");
  },

  /* ── SAFE SECTION ─────────────────────────────────────────── */
  _buildSafeSection() {
    const nodes = state.nodesDS.get().filter((n) => n.nodeType === "process");
    const edges = state.edgesDS.get();

    // Simple topological-style safe order: processes with no pending requests first
    const withoutReqs = nodes.filter(
      (n) => !edges.some((e) => e.from === n.id && e.edgeType === "req"),
    );
    const withReqs = nodes.filter((n) =>
      edges.some((e) => e.from === n.id && e.edgeType === "req"),
    );
    const ordered = [...withoutReqs, ...withReqs];

    const wrap = document.getElementById("safeBody");
    if (!ordered.length) {
      wrap.innerHTML =
        '<p style="font-size:11px;color:var(--text-muted)">No processes to order.</p>';
      return;
    }

    let html = '<div class="safe-seq-wrap">';
    ordered.forEach((n, i) => {
      html += `<span class="safe-node">${n.id}</span>`;
      if (i < ordered.length - 1) html += `<span class="safe-arrow">→</span>`;
    });
    html += `</div><p class="safe-note">Processes with no pending requests (${withoutReqs.map((n) => n.id).join(", ") || "none"}) can execute and release resources first, allowing others to proceed.</p>`;
    wrap.innerHTML = html;
  },
};

/* ══════════════════════════════════════════════════════════════
   UI CONTROLLER
══════════════════════════════════════════════════════════════ */
const UIController = {
  updateEdgeHint(text) {
    const h = document.getElementById("edgeHint");
    h.style.display = state.mode === "connect" ? "block" : "none";
    document.getElementById("edgeHintText").textContent = text;
  },
  setStatus(type, text) {
    document.querySelector(".status-dot").className = `status-dot ${type}`;
    document.getElementById("statusText").textContent = text;
  },
  showBanner(hasCycle) {
    const banner = document.getElementById("resultBanner");
    const inner = document.getElementById("bannerInner");
    banner.style.display = "block";
    if (hasCycle) {
      inner.className = "banner-inner deadlock";
      document.getElementById("bannerIcon").textContent = "⚠";
      document.getElementById("bannerText").textContent = "DEADLOCK DETECTED";
      this.setStatus("danger", "Deadlock!");
    } else {
      inner.className = "banner-inner no-deadlock";
      document.getElementById("bannerIcon").textContent = "✓";
      document.getElementById("bannerText").textContent = "NO DEADLOCK";
      this.setStatus("ok", "Safe State");
    }
  },
};

/* ══════════════════════════════════════════════════════════════
   PUBLIC API  (called from HTML)
══════════════════════════════════════════════════════════════ */
function setMode(newMode) {
  state.mode = newMode;
  state.connectSource = null;

  document
    .querySelectorAll(".mode-btn")
    .forEach((b) => b.classList.remove("active"));

  const map = {
    process: "btnProcess",
    resource: "btnResource",
    connect: "btnConnect",
    removeProcess: "btnRemoveProcess",
    removeResource: "btnRemoveResource",
    disconnect: "btnDisconnect",
  };
  if (map[newMode])
    document.getElementById(map[newMode]).classList.add("active");

  const wrapper = document.querySelector(".canvas-wrapper");
  wrapper.className =
    "canvas-wrapper" + (newMode !== "none" ? ` mode-${newMode}` : "");

  const labels = {
    process: "◉ PROCESS MODE — Click empty canvas to add",
    resource: "▣ RESOURCE MODE — Click empty canvas to add",
    connect: "⟶ CONNECT MODE — Click source then target",
    removeProcess: "✖ REMOVE PROCESS MODE — Click process node",
    removeResource: "✖ REMOVE RESOURCE MODE — Click resource node",
    disconnect: "⛓ DISCONNECT MODE — Click edge",
    none: "← Select a mode to begin",
  };
  document.getElementById("modeText").textContent =
    labels[newMode] || labels.none;
  UIController.updateEdgeHint("Click source node…");
  UIController.setStatus(
    newMode !== "none" ? "active" : "idle",
    newMode !== "none"
      ? newMode[0].toUpperCase() + newMode.slice(1) + " Mode"
      : "Ready",
  );
}

function checkDeadlock() {
  if (!state.nodesDS.length) {
    showToast("Graph is empty — add nodes first", "error");
    return;
  }
  GraphManager.resetHighlights();

  const result = DeadlockEngine.detect();
  UIController.showBanner(result.hasCycle);
  AnalysisPanel.render(result);

  if (result.hasCycle) {
    GraphManager.highlightCycle(result.cycleNodes, result.cycleEdges);
    showToast(`Deadlock! Cycle: ${result.cycleNodes.join("→")}`, "warn");
  } else {
    showToast("Graph is in a safe state ✓");
  }
}

function resetGraph() {
  GraphManager.reset();
  AnalysisPanel.hide();
  UIController.setStatus("idle", "Ready");
  showToast("Graph cleared");
}

function saveImage() {
  const wrapper = document.querySelector(".canvas-wrapper");
  const bg =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--canvas-bg")
      .trim() || "#0a0c10";
  html2canvas(wrapper, { backgroundColor: bg, scale: 2 }).then((c) => {
    const a = document.createElement("a");
    a.download = "RAG-graph.png";
    a.href = c.toDataURL("image/png");
    a.click();
    showToast("Image saved ✓");
  });
}

/* ══════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════ */
function updateStats() {
  const nodes = state.nodesDS.get();
  document.getElementById("statProcesses").textContent = nodes.filter(
    (n) => n.nodeType === "process",
  ).length;
  document.getElementById("statResources").textContent = nodes.filter(
    (n) => n.nodeType === "resource",
  ).length;
  document.getElementById("statEdges").textContent = state.edgesDS.length;
}

function clearResults() {
  document.getElementById("resultBanner").style.display = "none";
  GraphManager.resetHighlights();
  AnalysisPanel.hide();
  UIController.setStatus("idle", "Ready");
}

let _toastT = null;
function showToast(msg, type = "info") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.style.borderColor =
    type === "error"
      ? "var(--red)"
      : type === "warn"
        ? "var(--orange)"
        : "var(--border-hi)";
  t.style.color =
    type === "error"
      ? "var(--red)"
      : type === "warn"
        ? "var(--orange)"
        : "var(--accent)";
  t.classList.add("show");
  clearTimeout(_toastT);
  _toastT = setTimeout(() => t.classList.remove("show"), 2800);
}

/** Create a DOM element with class and text */
function el(tag, cls, text = "") {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
}

function show(id) {
  document.getElementById(id).style.display = "";
}
function hide(id) {
  document.getElementById(id).style.display = "none";
}

/* ══════════════════════════════════════════════════════════════
   DEMO GRAPH  (3-process deadlock, preloaded)
══════════════════════════════════════════════════════════════ */
function loadDemoGraph() {
  setTimeout(() => {
    const T = THEMES[currentTheme];

    const addN = (id, shape, pos, type) => {
      const c = type === "process" ? T.process : T.resource;
      state.nodesDS.add({
        id,
        label: id,
        x: pos.x,
        y: pos.y,
        shape,
        color: {
          background: hexToRgba(c, 0.12),
          border: c,
          highlight: { background: hexToRgba(c, 0.25), border: c },
          hover: { background: hexToRgba(c, 0.25), border: c },
        },
        font: { color: c, face: "Orbitron", size: 13, bold: true },
        widthConstraint: { minimum: 54, maximum: 54 },
        heightConstraint: { minimum: 54, maximum: 54 },
        nodeType: type,
        title: `${type} ${id}`,
      });
    };

    state.processCount = 3;
    state.resourceCount = 3;
    addN("P1", "ellipse", { x: -180, y: -120 }, "process");
    addN("P2", "ellipse", { x: 180, y: -120 }, "process");
    addN("P3", "ellipse", { x: 0, y: 160 }, "process");
    addN("R1", "box", { x: -30, y: -240 }, "resource");
    addN("R2", "box", { x: 250, y: 50 }, "resource");
    addN("R3", "box", { x: -200, y: 60 }, "resource");

    const addE = (from, to, type) => {
      const clr = type === "req" ? T.req : T.alloc;
      state.edgesDS.add({
        from,
        to,
        label: type,
        edgeType: type,
        color: { color: clr, highlight: clr, hover: clr },
        width: 2,
      });
    };

    // Deadlock: P1→R1→P2→R2→P3→R3→P1
    addE("P1", "R1", "req");
    addE("R1", "P2", "alloc");
    addE("P2", "R2", "req");
    addE("R2", "P3", "alloc");
    addE("P3", "R3", "req");
    addE("R3", "P1", "alloc");

    updateStats();
    state.network.fit({
      animation: { duration: 800, easingFunction: "easeInOutQuad" },
    });
    showToast("Demo loaded — click Detect Deadlock!");
  }, 600);
}

/* ══════════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  GraphManager.init();
  loadDemoGraph();
  setMode("none");
});
