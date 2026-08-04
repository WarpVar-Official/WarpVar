const varSelect = document.getElementById("varSelect");
const resultEl = document.getElementById("result");

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

  const vars = results.map(r => r.result).find(r => r) || [];
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
})();

// Handle Set button
document.getElementById("applyBtn").addEventListener("click", async () => {
  const varName = varSelect.value;
  const rawValue = document.getElementById("varValue").value.trim();

  if (!varName) {
    resultEl.textContent = "❌ Please select a variable.";
    return;
  }

  let value;
  try {
    value = JSON.parse(rawValue); // allow numbers, booleans, JSON
  } catch {
    value = rawValue; // fallback to string
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      world: "MAIN",
      args: [varName, value],
      func: (varName, value) => {
        if (!window.vm) return "⚠️ Scratch VM not found.";
        const stage = window.vm.runtime.getTargetForStage();

        for (const id in stage.variables) {
          const variable = stage.variables[id];
          if (variable.name === varName) {
            variable.value = value;
            return `✅ Set "${varName}" to ${value}`;
          }
        }
        return `❌ Variable "${varName}" not found.`;
      }
    });

    const msg = results.map(r => r.result).find(r => r) 
             || "⚠️ Could not update variable.";
    resultEl.textContent = msg;

  } catch (err) {
    resultEl.textContent = "Error: " + err.message;
  }
});
