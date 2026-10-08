/**
 * "Mark today's practice complete" card for the stage pages.
 * Drop <div id="ib101-progress" data-stage="stage-1"></div> where it should
 * appear, then load this file. Talks to /api/me and /api/progress.
 */
(function () {
  var host = document.getElementById("ib101-progress");
  if (!host) return;
  var stage = host.getAttribute("data-stage");
  var NEXT = { "stage-1": ["Stage 2", "/stage2-clarity"], "stage-2": ["Stage 3", "/stage3-inner-balance"], "stage-3": null };

  var css = document.createElement("style");
  css.textContent =
    ".ib101-prog{max-width:640px;margin:56px auto;padding:28px 30px;background:#F0E8DC;border:1px solid rgba(44,36,32,0.16);font-family:'Jost',system-ui,sans-serif;color:#2C2420;border-radius:3px}" +
    ".ib101-prog-kicker{font-size:11px;font-weight:500;letter-spacing:.2em;text-transform:uppercase;color:#4F6861;margin:0 0 10px}" +
    ".ib101-prog-count{font-family:'Vollkorn',Georgia,serif;font-size:32px;font-weight:500;line-height:1.15;margin:0 0 4px;}" +
    ".ib101-prog-sub{font-size:13.5px;font-weight:300;color:#6B5B4E;margin:0 0 16px;line-height:1.55}" +
    ".ib101-prog-bar{height:3px;background:rgba(79,104,97,0.18);margin:0 0 20px;overflow:hidden}" +
    ".ib101-prog-fill{height:100%;background:#4F6861;transition:width .5s ease}" +
    ".ib101-prog-btn{font-family:'Jost',system-ui,sans-serif;font-size:17px;font-weight:500;background:#C4A882;color:#2C2420;border:0;border-radius:3px;min-height:48px;padding:12px 28px;cursor:pointer}" +
    ".ib101-prog-btn:hover{background:#D3BA97}.ib101-prog-btn[disabled]{opacity:.55;cursor:default}" +
    ".ib101-prog-done{font-size:14px;font-weight:400;color:#4F6861;margin:0}" +
    ".ib101-prog-link{background:none;border:0;padding:0;margin-left:14px;font:inherit;font-size:12.5px;font-weight:300;color:#6B5B4E;text-decoration:underline;cursor:pointer}" +
    ".ib101-prog-a{display:inline-block;margin-top:14px;font-size:15px;font-weight:500;color:#2C2420;border-bottom:1px solid #4F6861;padding-bottom:2px;text-decoration:none}";
  document.head.appendChild(css);

  function pad(n) { return String(n).padStart(2, "0"); }
  function localDate() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

  function render(s, per) {
    host.className = "ib101-prog";
    var left = Math.max(per - s.count, 0);
    var html = '<p class="ib101-prog-kicker">Your progress</p>' +
      '<p class="ib101-prog-count">' + s.count + " of " + per + " days</p>";
    if (s.complete) {
      html += '<p class="ib101-prog-sub">This stage is complete. You can keep coming back to the practice whenever you need it.</p>';
    } else {
      html += '<p class="ib101-prog-sub">' + left + (left === 1 ? " day" : " days") + " to go." +
        (s.streak > 1 ? " You are on a " + s.streak + "-day run." : "") +
        " Missing a day does not reset anything.</p>";
    }
    html += '<div class="ib101-prog-bar"><div class="ib101-prog-fill" style="width:' + s.pct + '%"></div></div>';
    if (s.doneToday) {
      html += '<p class="ib101-prog-done">Today is marked complete.<button class="ib101-prog-link" id="ib101-undo" type="button">Undo</button></p>';
    } else {
      html += '<button class="ib101-prog-btn" id="ib101-done" type="button">I did today\'s practice</button>';
    }
    var next = NEXT[stage];
    if (s.complete && next) html += '<br><a class="ib101-prog-a" href="' + next[1] + '">Open ' + next[0] + " &rarr;</a>";
    html += '<br><a class="ib101-prog-a" href="/dashboard.html" style="border-color:transparent;color:#6B5B4E;text-transform:none;letter-spacing:0;font-weight:400;font-size:15px;text-decoration:underline">Back to your dashboard</a>';
    host.innerHTML = html;

    var done = document.getElementById("ib101-done");
    var undo = document.getElementById("ib101-undo");
    if (done) done.onclick = function () { send("complete", done, per); };
    if (undo) undo.onclick = function () { send("undo", undo, per); };
  }

  function send(action, btn, per) {
    btn.disabled = true;
    fetch("/api/progress", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: stage, action: action, date: localDate() }),
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.j && res.j.error);
        render(res.j, per);
      })
      .catch(function () {
        btn.disabled = false;
        var p = document.createElement("p");
        p.className = "ib101-prog-sub";
        p.textContent = "That did not save. Check your connection and try again.";
        host.appendChild(p);
      });
  }

  fetch("/api/me?d=" + localDate(), { credentials: "same-origin" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (me) {
      if (!me) return;
      var s = me.stages.filter(function (x) { return x.slug === stage; })[0];
      if (s) render(s, me.daysPerStage);
    })
    .catch(function () {});
})();
