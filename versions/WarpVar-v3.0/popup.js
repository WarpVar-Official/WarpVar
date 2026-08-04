const varSelect = document.getElementById("varSelect");
const resultEl = document.getElementById("result");
const searchBar = document.getElementById("searchBar");
const foreverChk = document.getElementById("foreverChk");
const intervalInput = document.getElementById("intervalMs");


let allVars = []; // keep full list

// Load variable list when popup opens
(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    world: "MAIN",
    func: () => {
      if (!window.vm) return null;

      const stage = window.vm.runtime.getTargetForStage();
      const vars = [];
      for (const id in stage.variables) {
        const v = stage.variables[id];
        vars.push({ name: v.name, value: v.value });
      }
      return vars;
    }
  });

  allVars = results.map(r => r.result).find(r => r) || [];
  renderVarOptions(allVars);
})();

function renderVarOptions(vars) {
  varSelect.innerHTML = "";
  if (vars.length === 0) {
    varSelect.innerHTML = `<option value="">⚠️ No variables found</option>`;
  } else {
    for (const v of vars) {
      const opt = document.createElement("option");
      opt.value = v.name;
      opt.textContent = `${v.name} (current: ${v.value})`;
      varSelect.appendChild(opt);
    }
  }
}

// Filter variables when typing
searchBar.addEventListener("input", () => {
  const query = searchBar.value.toLowerCase();
  const filtered = allVars.filter(v => v.name.toLowerCase().includes(query));
  renderVarOptions(filtered);
});

// Auto-select first match on Enter
searchBar.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    const query = searchBar.value.toLowerCase();
    const filtered = allVars.filter(v => v.name.toLowerCase().includes(query));
    if (filtered.length > 0) {
      varSelect.value = filtered[0].name;
    }
  }
});

// Handle Set button

document.getElementById("applyBtn").addEventListener("click", async () => {
  const varName = varSelect.value;
  const rawValue = document.getElementById("varValue").value.trim();
  const forever = document.getElementById("foreverChk").checked;
  const intervalMs = parseInt(document.getElementById("intervalMs").value) || 500;

  if (!varName) {
    resultEl.textContent = "❌ Please select a variable.";
    return;
  }
  if (rawValue === "") {
    resultEl.textContent = "❌ Please enter a value.";
    return;
  }
  // Try to parse as number; if not a number, still allow string
  const numVal = Number(rawValue);
  const useNumber = !Number.isNaN(numVal);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (forever) {
      // start a repeating updater in the page context
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        world: "MAIN",
        func: (vName, vVal, isNumber, ms) => {
          // ensure storage for intervals
          window.__warpvar_intervals = window.__warpvar_intervals || {};
          // clear existing interval for this variable if present
          if (window.__warpvar_intervals[vName]) {
            clearInterval(window.__warpvar_intervals[vName].id);
            delete window.__warpvar_intervals[vName];
          }
          // set once immediately
          const setOnce = () => {
            if (!window.vm) return;
            const stage = window.vm.runtime.getTargetForStage();
            for (const id in stage.variables) {
              const v = stage.variables[id];
              if (v.name === vName) {
                v.value = isNumber ? Number(vVal) : vVal;
                return true;
              }
            }
            return false;
          };
          setOnce();
          // start interval
          const id = setInterval(() => {
            setOnce();
          }, ms);
          window.__warpvar_intervals[vName] = { id: id, value: vVal, isNumber: isNumber, ms: ms };
          return `✅ Started repeating set for "${vName}" every ${ms}ms.`;
        },
        args: [varName, useNumber ? numVal : rawValue, useNumber, intervalMs]
      });
      resultEl.textContent = results.map(r => r.result).find(r => r) || "✅ Started repeating set.";
    } else {
      // clear any existing repeating updater for this variable, then set once
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        world: "MAIN",
        func: (vName, vVal, isNumber) => {
          if (!window.vm) return "⚠️ No VM found.";
          // clear interval if exists
          if (window.__warpvar_intervals && window.__warpvar_intervals[vName]) {
            clearInterval(window.__warpvar_intervals[vName].id);
            delete window.__warpvar_intervals[vName];
          }
          const stage = window.vm.runtime.getTargetForStage();
          for (const id in stage.variables) {
            const v = stage.variables[id];
            if (v.name === vName) {
              v.value = isNumber ? Number(vVal) : vVal;
              return `✅ Set "${vName}" to ${v.value}.`;
            }
          }
          return `❌ Variable "${vName}" not found.`;
        },
        args: [varName, useNumber ? numVal : rawValue, useNumber]
      });
      resultEl.textContent = results.map(r => r.result).find(r => r) || "⚠️ Could not update variable.";
    }
  } catch (err) {
    resultEl.textContent = "Error: " + err.message;
  }
});
