/* ================================================================
   ASHES OF THE NORTH — BOOT / START SCREEN
   ================================================================ */

(function () {
  function showStartScreen() {
    const hasSave = GameEngine.hasSave();
    const wrap = document.createElement("div");
    wrap.className = "startscreen";
    wrap.id = "startScreen";
    wrap.innerHTML =
      '<h1>Ashes of the North</h1>' +
      '<div class="subtitle">A settlement rises from the ruins of the Northern frontier.</div>' +
      (hasSave ? '<button class="btn primary" id="continueBtn">Continue Settlement</button>' : '') +
      '<input type="text" id="settlementNameInput" placeholder="Name your settlement" maxlength="24">' +
      '<button class="btn' + (hasSave ? '' : ' primary') + '" id="newGameBtn2">Found a New Settlement</button>' +
      (hasSave ? '<button class="btn danger" id="eraseBtn">Erase Save</button>' : '');
    document.body.appendChild(wrap);

    if (hasSave) {
      document.getElementById("continueBtn").addEventListener("click", () => {
        const res = GameEngine.loadGame();
        if (!res.ok) { alert(res.reason); return; }
        wrap.remove();
        UI.init(res.state);
      });
      document.getElementById("eraseBtn").addEventListener("click", () => {
        if (confirm("Erase your saved settlement? This cannot be undone.")) {
          GameEngine.deleteSave();
          wrap.remove();
          showStartScreen();
        }
      });
    }
    document.getElementById("newGameBtn2").addEventListener("click", () => {
      const name = document.getElementById("settlementNameInput").value.trim();
      const state = GameEngine.newGame(name || "Ashholm");
      GameEngine.saveGame(state);
      wrap.remove();
      UI.init(state);
    });
  }

  window.startNewGameFlow = function () {
    const existing = document.getElementById("startScreen");
    if (existing) existing.remove();
    showStartScreen();
  };

  document.addEventListener("DOMContentLoaded", () => {
    showStartScreen();
  });
})();
