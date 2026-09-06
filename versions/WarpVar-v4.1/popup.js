const varSelect = document.getElementById("varSelect");
const resultEl = document.getElementById("result");
const searchBar = document.getElementById("searchBar");
const foreverChk = document.getElementById("foreverChk");
const intervalInput = document.getElementById("intervalMs");
const applyBtn = document.getElementById("applyBtn");
let applyBorderTimer;

let allVars = [];
let currentSelectedVariable = null;
let lockedVars = {};

// Force forever checkbox to always be true
function initializeForeverCheckbox() {
  foreverChk.checked = true;

  // Prevent any changes to the checkbox
  foreverChk.addEventListener("change", function (e) {
    e.preventDefault();
    this.checked = true;
  });

  // Also prevent any programmatic unchecking
  Object.defineProperty(foreverChk, "checked", {
    get: function () {
      return true;
    },
    set: function (value) {
      return true;
    },
  });
}

// Load variable list when popup opens
document.addEventListener("DOMContentLoaded", async () => {
  initializeForeverCheckbox();
  await refreshVariables();
});

// Enhanced variable fetching
async function getAllVariables() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab) {
      console.warn("No active tab found");
      return [];
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      world: "MAIN",
      func: () => {
        function findScratchVM() {
          // For TurboWarp
          if (window.vm) {
            return window.vm;
          }

          // For Scratch
          const appElement = document.getElementById("app");
          if (appElement) {
            const reactContainerKey = Object.keys(appElement).find((key) =>
              key.startsWith("__reactContainer$"),
            );
            if (reactContainerKey) {
              try {
                const rootFiber = appElement[reactContainerKey];
                const AppFiber = rootFiber.child;
                const store =
                  AppFiber?.pendingProps?.store ||
                  AppFiber?.memoizedProps?.store;
                if (store) {
                  return store.getState().scratchGui.vm;
                }
              } catch (e) {
                console.warn(
                  "Scratch Variable Controller: React detection failed",
                  e,
                );
              }
            }
          }

          // Alternative detection methods
          if (window.Scratch && window.Scratch.vm) {
            return window.Scratch.vm;
          }

          return null;
        }

        const vm = findScratchVM();
        if (!vm || !vm.runtime) {
          console.log("No VM found");
          return { variables: [], locks: {} };
        }

        const variables = [];

        // Get variables from all targets (sprites and stage)
        if (vm.runtime.targets) {
          vm.runtime.targets.forEach((target) => {
            if (target.variables) {
              Object.values(target.variables).forEach((variable) => {
                // Skip internal variables that start with _
                if (!variable.name.startsWith("_")) {
                  variables.push({
                    name: variable.name,
                    value: variable.value,
                    type: variable.type,
                    isCloud: variable.isCloud || false,
                    sprite: target.getName
                      ? target.getName()
                      : target.isStage
                        ? "Stage"
                        : "Sprite",
                    id: variable.id,
                  });
                }
              });
            }
          });
        }

        // Get cloud variables
        if (vm.runtime.ioDevices?.cloud?.vars) {
          Object.keys(vm.runtime.ioDevices.cloud.vars).forEach((varName) => {
            // Skip internal cloud variables
            if (!varName.startsWith("_")) {
              variables.push({
                name: varName,
                value: vm.runtime.ioDevices.cloud.vars[varName],
                type: "cloud",
                isCloud: true,
                sprite: "Cloud",
                id: "cloud_" + varName,
              });
            }
          });
        }

        // Get current locks
        const locks = window.__warpvar_locks || {};

        console.log(
          `Found ${variables.length} variables, ${Object.keys(locks).length} locked`,
        );
        return { variables, locks };
      },
    });

    const result = results?.[0]?.result;
    if (result) {
      lockedVars = result.locks || {};
      return result.variables || [];
    }
    return [];
  } catch (error) {
    console.error("Error fetching variables:", error);
    resultEl.textContent =
      "❌ Error: Cannot access Scratch page. Make sure you're on a Scratch or TurboWarp project.";
    return [];
  }
}

// Enhanced variable setting
async function setVariableValue(
  varName,
  newValue,
  foreverMode = false,
  intervalMs = 100,
) {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab) {
      return { success: false, message: "No active tab" };
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      world: "MAIN",
      func: (vName, vValue, isForeverMode, ms) => {
        function findScratchVM() {
          if (window.vm) return window.vm;

          const appElement = document.getElementById("app");
          if (appElement) {
            const reactContainerKey = Object.keys(appElement).find((key) =>
              key.startsWith("__reactContainer$"),
            );
            if (reactContainerKey) {
              try {
                const rootFiber = appElement[reactContainerKey];
                const AppFiber = rootFiber.child;
                const store =
                  AppFiber?.pendingProps?.store ||
                  AppFiber?.memoizedProps?.store;
                if (store) {
                  return store.getState().scratchGui.vm;
                }
              } catch (e) {}
            }
          }

          if (window.Scratch && window.Scratch.vm) {
            return window.Scratch.vm;
          }

          return null;
        }

        const vm = findScratchVM();
        if (!vm || !vm.runtime) {
          return { success: false, message: "No VM found" };
        }

        // Initialize globals
        window.__warpvar_locks = window.__warpvar_locks || {};
        window.__warpvar_intervals = window.__warpvar_intervals || {};

        // Clear existing interval if any
        if (window.__warpvar_intervals[vName]) {
          clearInterval(window.__warpvar_intervals[vName]);
          delete window.__warpvar_intervals[vName];
        }

        // Function to set variable value
        function setVar() {
          let variableFound = false;
          let actualValue = vValue;

          // Set variables in all targets
          if (vm.runtime.targets) {
            vm.runtime.targets.forEach((target) => {
              if (target.variables) {
                Object.values(target.variables).forEach((variable) => {
                  if (variable.name === vName) {
                    // Type conversion
                    if (
                      variable.type === "number" ||
                      variable.type === "math_number"
                    ) {
                      actualValue = isNaN(parseFloat(vValue))
                        ? 0
                        : parseFloat(vValue);
                    } else if (variable.type === "boolean") {
                      actualValue = Boolean(
                        vValue && vValue !== "false" && vValue !== "0",
                      );
                    } else {
                      actualValue = String(vValue);
                    }

                    variable.value = actualValue;
                    variableFound = true;

                    // Update display
                    if (target.blocks) {
                      if (
                        target.blocks._cache &&
                        typeof target.blocks._cache.variableChanged ===
                          "function"
                      ) {
                        target.blocks._cache.variableChanged(
                          vName,
                          actualValue,
                        );
                      }
                      if (target.blocks.requestBlockMaskUpdate) {
                        target.blocks.requestBlockMaskUpdate();
                      }
                    }
                  }
                });
              }
            });
          }

          // Set cloud variables
          if (vm.runtime.ioDevices?.cloud?.vars) {
            if (vm.runtime.ioDevices.cloud.vars[vName] !== undefined) {
              let cloudValue = vValue;
              if (typeof vm.runtime.ioDevices.cloud.vars[vName] === "number") {
                cloudValue = isNaN(parseFloat(vValue)) ? 0 : parseFloat(vValue);
              }
              vm.runtime.ioDevices.cloud.vars[vName] = cloudValue;
              variableFound = true;

              if (vm.runtime.ioDevices.cloud.updateVariable) {
                vm.runtime.ioDevices.cloud.updateVariable(vName, cloudValue);
              }
            }
          }

          return variableFound;
        }

        try {
          // Set the variable at least once
          const found = setVar();

          if (!found) {
            delete window.__warpvar_locks[vName];
            return { success: false, message: `Variable "${vName}" not found` };
          }

          // ALWAYS use forever mode (since checkbox is always true)
          window.__warpvar_locks[vName] = vValue;
          const intervalId = setInterval(setVar, ms);
          window.__warpvar_intervals[vName] = intervalId;
          console.log(
            `Forever mode started for ${vName} = ${vValue} (every ${ms}ms)`,
          );
          return {
            success: true,
            message: `✅ Forever mode: "${vName}" = ${vValue} (${ms}ms)`,
          };
        } catch (error) {
          return { success: false, message: "Error: " + error.message };
        }
      },
      args: [varName, newValue, true, intervalMs], // Always pass true for forever mode
    });

    return results?.[0]?.result || { success: false, message: "Unknown error" };
  } catch (error) {
    console.error("Error setting variable:", error);
    return { success: false, message: "Execution error: " + error.message };
  }
}

// Refresh variables list
async function refreshVariables() {
  resultEl.textContent = "Refreshing variables...";
  allVars = await getAllVariables();
  renderVarOptions(allVars);

  if (allVars.length > 0) {
    resultEl.textContent = `✅ Found ${allVars.length} variables`;
  } else {
    resultEl.textContent = "⚠️ No variables found";
  }
}

function renderVarOptions(vars) {
  varSelect.innerHTML = "";
  if (vars.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "⚠️ No variables found";
    varSelect.appendChild(opt);
  } else {
    vars.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v.name;

      const icon = v.isCloud ? "☁️" : "📊";
      const spriteInfo = v.sprite !== "Stage" ? ` (${v.sprite})` : "";
      const valueDisplay =
        String(v.value).length > 20
          ? String(v.value).substring(0, 20) + "..."
          : v.value;

      // Check if variable is locked
      const isLocked = lockedVars[v.name] !== undefined;
      const locked = isLocked ? " 🔒" : "";

      opt.textContent = `${icon} ${v.name}: ${valueDisplay}${spriteInfo}${locked}`;
      opt.title = `Type: ${v.type} | Sprite: ${v.sprite} | Value: ${v.value}`;

      if (isLocked) {
        opt.classList.add("locked-variable");
      }

      varSelect.appendChild(opt);
    });
  }
}

// Filter variables when typing
searchBar.addEventListener("input", () => {
  const query = searchBar.value.toLowerCase();
  const filtered = allVars.filter(
    (v) =>
      v.name.toLowerCase().includes(query) ||
      v.sprite.toLowerCase().includes(query),
  );
  renderVarOptions(filtered);
});

// Auto-select first match on Enter
searchBar.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const query = searchBar.value.toLowerCase();
    const filtered = allVars.filter((v) =>
      v.name.toLowerCase().includes(query),
    );
    if (filtered.length > 0) {
      varSelect.value = filtered[0].name;
      onVariableSelect();
    }
  }
});

// Variable selection handler
function onVariableSelect() {
  currentSelectedVariable = varSelect.value;
  if (currentSelectedVariable) {
    // Find current value
    const variable = allVars.find((v) => v.name === currentSelectedVariable);
    if (variable) {
      document.getElementById("varValue").value = variable.value;
    }

    // Forever checkbox is always checked, no need to update it
  } else {
    document.getElementById("varValue").value = "";
    // Forever checkbox remains checked (always true)
  }
}

varSelect.addEventListener("change", onVariableSelect);

// Apply button handler
document.getElementById("applyBtn").addEventListener("click", async () => {
  // Add animation effects
  applyBtn.classList.remove("apply-animate");
  void applyBtn.offsetWidth;
  applyBtn.classList.add("apply-animate");
  document.body.classList.add("apply-border");
  clearTimeout(applyBorderTimer);
  applyBorderTimer = setTimeout(() => {
    document.body.classList.remove("apply-border");
  }, 900);

  const varName = currentSelectedVariable;
  const rawValue = document.getElementById("varValue").value.trim();
  const intervalMs = Math.max(50, parseInt(intervalInput.value) || 100);

  if (!varName) {
    resultEl.textContent = "❌ Please select a variable.";
    return;
  }
  if (rawValue === "") {
    resultEl.textContent = "❌ Please enter a value.";
    return;
  }

  resultEl.textContent = "Setting variable...";

  // Always use forever mode (checkbox is always true)
  const result = await setVariableValue(varName, rawValue, true, intervalMs);
  resultEl.textContent = result.success
    ? `✅ ${result.message}`
    : `❌ ${result.message}`;

  // Refresh display after a short delay
  setTimeout(refreshVariables, 300);
});

// Initialize
refreshVariables();
