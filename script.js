let nodes = new vis.DataSet([]);
let edges = new vis.DataSet([]);

let container = document.getElementById("network");

let data = {
    nodes: nodes,
    edges: edges,
};

let options = {
    nodes: {
        shape: "dot",
        size: 20,
        font: { size: 16, color: "#000" }
    },
    edges: {
        arrows: "to",
        color: "#000",
        width: 2
    },
    physics: {
        enabled: true
    }
};

let network = new vis.Network(container, data, options);

// Add Node
function addNode() {
    let name = document.getElementById("nodeName").value;
    if (name === "") return;

    let color = name.startsWith("P") ? "#4CAF50" : "#2196F3";

    nodes.add({
        id: name,
        label: name,
        color: color
    });

    document.getElementById("nodeName").value = "";
}

// Add Edge
function addEdge() {
    let from = document.getElementById("from").value;
    let to = document.getElementById("to").value;

    if (from === "" || to === "") return;

    edges.add({
        id: from + "->" + to,
        from: from,
        to: to
    });

    document.getElementById("from").value = "";
    document.getElementById("to").value = "";
}

// Build Graph
function buildGraph() {
    let graph = {};
    edges.forEach(edge => {
        if (!graph[edge.from]) graph[edge.from] = [];
        graph[edge.from].push(edge.to);
    });
    return graph;
}

// Find Cycle Path
function findCycle(graph) {
    let visited = new Set();
    let recStack = [];
    let stackSet = new Set();

    function dfs(node) {
        if (!visited.has(node)) {
            visited.add(node);
            recStack.push(node);
            stackSet.add(node);

            let neighbors = graph[node] || [];
            for (let n of neighbors) {
                if (!visited.has(n)) {
                    let result = dfs(n);
                    if (result) return result;
                } 
                else if (stackSet.has(n)) {
                    let cycleStart = recStack.indexOf(n);
                    return recStack.slice(cycleStart);
                }
            }
        }

        recStack.pop();
        stackSet.delete(node);
        return null;
    }

    for (let node in graph) {
        let result = dfs(node);
        if (result) return result;
    }

    return null;
}

// Highlight Cycle
function highlightCycle(cycle) {
    // Reset all styles
    nodes.forEach(n => {
        nodes.update({ id: n.id, color: n.label.startsWith("P") ? "#4CAF50" : "#2196F3" });
    });

    edges.forEach(e => {
        edges.update({ id: e.id, color: "#000", width: 2 });
    });

    // Highlight nodes
    cycle.forEach(node => {
        nodes.update({
            id: node,
            color: "#FF0000",
            size: 30
        });
    });

    // Highlight edges in cycle
    for (let i = 0; i < cycle.length; i++) {
        let from = cycle[i];
        let to = cycle[(i + 1) % cycle.length];

        let edgeId = from + "->" + to;

        if (edges.get(edgeId)) {
            edges.update({
                id: edgeId,
                color: "#FF0000",
                width: 4
            });
        }
    }
}

// Animate Cycle
function animateCycle(cycle) {
    let i = 0;

    let interval = setInterval(() => {
        let node = cycle[i];

        nodes.update({
            id: node,
            size: 40
        });

        setTimeout(() => {
            nodes.update({
                id: node,
                size: 30
            });
        }, 300);

        i++;
        if (i >= cycle.length) {
            clearInterval(interval);
        }
    }, 400);
}

// Check Deadlock
function checkDeadlock() {
    let graph = buildGraph();
    let result = document.getElementById("result");

    let cycle = findCycle(graph);

    if (cycle) {
        result.innerHTML = "❌ Deadlock Detected!";
        result.style.color = "red";

        highlightCycle(cycle);
        animateCycle(cycle);
    } else {
        result.innerHTML = "✅ No Deadlock";
        result.style.color = "lightgreen";
    }
}
function setMode(newMode, event) {
    mode = newMode;
    selectedNode = null;

    document.querySelectorAll("button").forEach(btn => btn.classList.remove("active"));
    event.target.classList.add("active");
}