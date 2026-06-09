const NAME_KEY = "buyopoyo_name";
const BASE = import.meta.env.BASE_URL as string;

export function getSavedName(): string {
  return localStorage.getItem(NAME_KEY) ?? "";
}

function injectStyle(): void {
  if (document.getElementById("byo-name-style")) return;
  const s = document.createElement("style");
  s.id = "byo-name-style";
  s.textContent = `
    @keyframes byoTop10Pop {
      0%   { transform:scale(0.15) rotate(-6deg); opacity:0; }
      55%  { transform:scale(1.14) rotate(2deg);  opacity:1; }
      75%  { transform:scale(0.92) rotate(-1deg); }
      100% { transform:scale(1)    rotate(0deg);  }
    }
    @keyframes byoFadeUp {
      0%   { opacity:0; transform:translateY(10px); }
      100% { opacity:1; transform:translateY(0); }
    }
    .byo-btn img { transition:transform 0.07s; }
    .byo-btn:active img { transform:scale(0.90); }
  `;
  document.head.appendChild(s);
}

function btnSpan(text: string, stroke: string, size: number): string {
  return `<span style="
    position:absolute;top:50%;left:50%;
    transform:translate(-50%,-58%);
    pointer-events:none;white-space:nowrap;
    font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans',sans-serif;
    font-size:${size}px;font-weight:bold;
    color:#fff;
    -webkit-text-stroke:3px ${stroke};
    paint-order:stroke fill;
  ">${text}</span>`;
}

export function showNameInput(
  score: number,
  onSubmit: (name: string) => void,
  onSkip: () => void,
): void {
  injectStyle();

  const overlay = document.createElement("div");
  overlay.id = "byo-name-overlay";
  overlay.style.cssText =
    "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;" +
    "z-index:2000;background:rgba(10,4,24,0.90);";

  const saved = getSavedName().replace(/"/g, "&quot;");

  overlay.innerHTML = `
    <div style="
      background:linear-gradient(160deg,#1a0a3a 0%,#0e0528 100%);
      border:2px solid #b06bdb;border-radius:20px;
      padding:16px 22px 22px;width:88%;max-width:360px;
      text-align:center;
      box-shadow:0 0 40px rgba(176,107,219,0.4);
      font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans',sans-serif;
      animation:byoFadeUp 0.22s ease both;
    ">
      <img src="${BASE}top10.png" style="
        width:92%;max-width:300px;display:block;margin:0 auto 4px;
        animation:byoTop10Pop 0.55s cubic-bezier(.22,.68,0,1.2) both;
      " />
      <div style="color:#fff;font-size:32px;font-weight:bold;margin-bottom:14px;
                  text-shadow:0 0 12px #cc44aa;
                  animation:byoFadeUp 0.25s 0.35s both;opacity:0;">
        ${score.toLocaleString()}
      </div>
      <input id="byo-name-input" type="text" maxlength="8"
        placeholder="なまえ（8文字まで）"
        value="${saved}"
        autocomplete="off" autocorrect="off" spellcheck="false"
        style="
          width:100%;box-sizing:border-box;
          padding:12px 16px;font-size:20px;
          border-radius:12px;border:2px solid #b06bdb;
          background:#0a0418;color:#fff;outline:none;
          text-align:center;margin-bottom:12px;
          font-family:inherit;
          animation:byoFadeUp 0.25s 0.42s both;opacity:0;
        "
      />
      <div style="display:flex;gap:10px;height:54px;
                  animation:byoFadeUp 0.25s 0.50s both;opacity:0;">
        <button id="byo-name-submit" class="byo-btn" style="
          flex:3;position:relative;background:none;border:none;padding:0;cursor:pointer;
        ">
          <img src="${BASE}button-green.png" style="width:100%;height:100%;object-fit:fill;display:block;" />
          ${btnSpan("けってい", "#1a5500", 18)}
        </button>
        <button id="byo-name-skip" class="byo-btn" style="
          flex:2;position:relative;background:none;border:none;padding:0;cursor:pointer;
        ">
          <img src="${BASE}button-red.png" style="width:100%;height:100%;object-fit:fill;display:block;" />
          ${btnSpan("とばす", "#881100", 16)}
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const input = document.getElementById("byo-name-input") as HTMLInputElement;
  const submitBtn = document.getElementById("byo-name-submit") as HTMLButtonElement;
  const skipBtn = document.getElementById("byo-name-skip") as HTMLButtonElement;

  input.focus();
  if (saved) input.select();

  let done = false;

  const doSubmit = (): void => {
    if (done) return;
    const name = input.value.trim().slice(0, 8);
    if (!name) {
      input.style.borderColor = "#ff5555";
      input.focus();
      return;
    }
    done = true;
    submitBtn.disabled = true;
    skipBtn.disabled = true;
    localStorage.setItem(NAME_KEY, name);
    overlay.remove();
    onSubmit(name);
  };

  const doSkip = (): void => {
    if (done) return;
    done = true;
    overlay.remove();
    onSkip();
  };

  submitBtn.addEventListener("click", doSubmit);
  skipBtn.addEventListener("click", doSkip);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSubmit();
    if (e.key === "Escape") doSkip();
  });
}
