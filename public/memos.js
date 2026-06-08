const list = document.getElementById("memoList");

async function load() {
  try {
    const res = await fetch("/api/memos").then((r) => r.json());
    if (!res.ok || !res.memos?.length) {
      list.innerHTML = '<div class="empty">还没有备忘录。在首页对老婆说的话使用 AI 分析后，点击「记入备忘录」即可。</div>';
      return;
    }
    list.innerHTML = res.memos.map((m) => {
      const time = new Date(m.created_at).toLocaleString("zh-CN");
      return `<div class="memo-card">
        <div class="memo-source">📌 来源: ${esc(m.source || "")}</div>
        <div class="memo-body">${esc(m.ai_reply || "")}</div>
        <div class="memo-time">${time}</div>
        <div class="memo-actions"><button onclick="del(${m.id})">删除</button></div>
      </div>`;
    }).join("");
  } catch { list.innerHTML = '<div class="empty">加载失败，请检查网络</div>'; }
}

window.del = async function(id) {
  if (!confirm("删除这条备忘录？")) return;
  try { await fetch("/api/memos/" + id, { method: "DELETE" }); load(); }
  catch (e) { alert("删除失败: " + e.message); }
};

function esc(s) { const d = document.createElement("div"); d.textContent = s || ""; return d.innerHTML; }

load();
