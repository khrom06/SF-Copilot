/* ===================================================================== KIT */
// Look of the card: the SF palette (dark, light) as custom properties on :host, so that every colour below is a token (test/lint.js).
const SFCP_CSS = `
  :host { display:block; --c:#00e5ff; --c-rgb:0 229 255; --a:#ffb300; --a-rgb:255 179 0; --g:#2bff88; --r:#ff3355; --tx:#cfefff; --dim:#7fa3bd; --st:#fff;
    --b0:#0d2440; --b1:#06101d; --b2:#03080f; --on:#03080f; }
  :host([theme="light"]) { --c:#00798f; --c-rgb:0 121 143; --a:#a85f00; --a-rgb:168 95 0; --g:#08783f; --r:#c8173d; --tx:#1c3a4e; --dim:#37536a; --st:#04141f;
    --b0:#fbfdff; --b1:#eef5fb; --b2:#e2edf6; --on:#fff; }
  .hud { position:relative; overflow:hidden; box-sizing:border-box; border-radius:14px; padding:16px 18px 18px; color:var(--tx);
    background:radial-gradient(ellipse at 50% -20%, var(--b0) 0%, var(--b1) 60%, var(--b2) 100%); border:1px solid rgb(var(--c-rgb) / .22);
    font-family:'B612 Mono', ui-monospace, monospace; font-size:13px; box-shadow:inset 0 0 40px rgb(var(--c-rgb) / .06), 0 0 22px rgb(var(--c-rgb) / .07); }
  .c { position:absolute; width:14px; height:14px; border:0 solid var(--c); opacity:.8; }
  .tl { top:6px; left:6px; border-width:2px 0 0 2px; } .br { bottom:6px; right:6px; border-width:0 2px 2px 0; }
  .head { display:flex; align-items:center; gap:10px; margin-bottom:14px; font-family:Orbitron, sans-serif; font-weight:700; font-size:12px; letter-spacing:.22em;
    text-transform:uppercase; color:var(--c); text-shadow:0 0 8px rgb(var(--c-rgb) / .6); }
  .head .sub { margin-left:auto; font-family:'B612 Mono', monospace; font-weight:400; letter-spacing:.06em; font-size:10px; color:var(--dim); text-shadow:none; text-transform:none; text-align:end; }
  .msg { color:var(--dim); line-height:1.6; }
  .err { color:var(--r); }
  .p { border:1px solid rgb(var(--c-rgb) / .2); border-radius:10px; padding:12px; margin-bottom:10px; background:rgb(var(--c-rgb) / .03); }
  .p.trial { border-color:rgb(var(--a-rgb) / .55); }
  .p.done { border-color:color-mix(in srgb, var(--g) 50%, transparent); }
  .ti { display:flex; gap:10px; align-items:flex-start; color:var(--st); font-size:13.5px; line-height:1.45; }
  .ti ha-icon { flex:none; color:var(--c); --mdc-icon-size:20px; margin-top:1px; }
  .ev { margin:6px 0 0 30px; color:var(--dim); font-size:11.5px; line-height:1.5; }
  .strip { display:flex; flex-wrap:wrap; gap:3px; margin:8px 0 0 30px; }
  .strip i { width:9px; height:14px; border-radius:2px; background:rgb(var(--c-rgb) / .14); }
  .strip i.hit { background:var(--c); box-shadow:0 0 5px rgb(var(--c-rgb) / .6); } .strip i.na { background:transparent; border:1px dashed rgb(var(--c-rgb) / .2); box-sizing:border-box; }
  .cf { display:flex; align-items:center; gap:8px; margin:8px 0 0 30px; font-size:10px; letter-spacing:.12em; text-transform:uppercase; color:var(--dim); }
  .cf .tr { flex:1; max-width:160px; height:5px; border-radius:3px; background:rgb(var(--c-rgb) / .12); overflow:hidden; } .cf .tr b { display:block; height:100%; background:var(--c); }
  .badge { margin:8px 0 0 30px; font-size:11.5px; color:var(--a); } .done .badge { color:var(--g); }
  .acts { display:flex; flex-wrap:wrap; gap:8px; margin:10px 0 0 30px; }
  button { font:inherit; font-size:11.5px; min-height:40px; padding:6px 12px; border-radius:8px; border:1px solid rgb(var(--c-rgb) / .3); background:rgb(var(--c-rgb) / .06); color:var(--tx); cursor:pointer; }
  button:hover { border-color:var(--c); } button:focus-visible { outline:2px solid var(--c); outline-offset:2px; }
  button.pri { background:var(--c); color:var(--on); border-color:var(--c); }
  button.armed { background:var(--a); border-color:var(--a); color:var(--on); }
  button[disabled] { opacity:.5; cursor:default; }
  details { margin:8px 0 0 30px; } summary { cursor:pointer; color:var(--dim); font-size:11.5px; }
  pre { margin:6px 0 0; padding:10px; border-radius:8px; background:rgb(0 0 0 / .25); color:var(--tx); font-size:11px; overflow:auto; max-height:260px; white-space:pre; }
  :host([theme="light"]) pre { background:rgb(var(--c-rgb) / .06); }
  .foot { display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:space-between; margin-top:6px; color:var(--dim); font-size:11px; }
  @media (prefers-reduced-motion: reduce) { * { transition:none !important; animation:none !important; } }
`;
