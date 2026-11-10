#!/usr/bin/env python3
"""Turn the approved Ether design (the Claude artifact's ether.html) into the standalone app page.
Usage: python3 scripts/port.py path/to/ether.html  ->  writes public/index.html
Every change is an exact find/replace, so re-running on a newer design fails loudly if something moved."""
import sys, pathlib

src = pathlib.Path(sys.argv[1]).read_text()
s = src

def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n < 1:
        sys.exit('PORT FAILED, not found:\n' + old[:200])
    s = s.replace(old, new, count)

# ---------- document head: real web app ----------
rep('<title>Ether</title>\n<meta name="claude:viewport-fit-sides" content="cover">',
'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Ether</title>
<meta name="theme-color" content="#05070f">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Ether">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icons/icon-192.png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="stylesheet" href="/app.css">''')
rep('<canvas id="field" aria-hidden="true"></canvas>', '</head>\n<body>\n<canvas id="field" aria-hidden="true"></canvas>')
rep('<script>\n(function(){', '<script src="/vendor/supabase.js"></script>\n<script src="/runtime.js"></script>\n<script src="/voice.js"></script>\n<script>\n(function(){')
s = s.rstrip()
if not s.endswith('</script>'):
    sys.exit('PORT FAILED: expected file to end with </script>')
s += '\n<script src="/app.js"></script>\n</body>\n</html>\n'

# ---------- natural voice: speak through EtherVoice, fall back to the device voice ----------
rep('''function stopSpeak(){
  speakToken++; clearTimeout(speakTimer);
  try{ speechSynthesis.cancel(); }catch(e){}''', '''function stopSpeak(){
  speakToken++; clearTimeout(speakTimer);
  try{ speechSynthesis.cancel(); }catch(e){}
  try{ window.EtherVoice&&EtherVoice.stop(); }catch(e){}''')
rep('''  const done=()=>{ if(token!==speakToken) return; document.body.classList.remove('speaking'); $('core-hint').textContent='Tap to brief'; };''',
'''  const done=()=>{ if(token!==speakToken) return; document.body.classList.remove('speaking'); $('core-hint').textContent='Tap to brief'; document.dispatchEvent(new CustomEvent('ether-spoke')); };
  if(window.EtherWake&&EtherWake.enabled) EtherWake.pause();''')
rep('''    const fallback=()=>{ if(token===speakToken) speakTimer=setTimeout(next,Math.max(2000,line.length*55)); };
    try{''', '''    const fallback=()=>{ if(token===speakToken) speakTimer=setTimeout(next,Math.max(2000,line.length*55)); };
    if(window.EtherVoice&&EtherVoice.available()){
      if(lines[i]) EtherVoice.prefetch(lines[i]);
      EtherVoice.speak(line).then(()=>{ if(token===speakToken) speakTimer=setTimeout(next,160); }).catch(err=>{ const c=err&&err.code; if(c==='voice_no_credit'||c==='voice_key_invalid'){ setCaption(c==='voice_no_credit'?'My voice service (OpenAI) is out of credit, so I can’t speak right now. Add credit at platform.openai.com → Billing.':'My voice service key isn’t working. Check OPENAI_API_KEY in Vercel.'); done(); return; } deviceSpeak(); });
      return;
    }
    deviceSpeak();
    function deviceSpeak(){
    try{''')
rep('''      speechSynthesis.speak(u);
    }catch(e){ fallback(); }
  };''', '''      speechSynthesis.speak(u);
    }catch(e){ fallback(); }
    }
  };''')

# ---------- one-button talk: real microphone ----------
rep("""$('talk').addEventListener('click',()=>{ stopSpeak(); const a=$('ask'); a.placeholder='Listening… tap the mic on your keyboard and talk'; a.focus(); setTimeout(()=>{ a.placeholder='Talk or type to Ether…'; },8000); });""",
"""$('talk').addEventListener('click',()=>{ window.etherListen?etherListen():$('ask').focus(); });""")

# ---------- Spotify: real playback ----------
rep('''       const r=await mcp.callTool('Spotify','search',{prompt:String(inp.query||'').slice(0,300),language:'en-US',limit:5},{signal:ctx.signal});
       const ents=(r.payload&&Array.isArray(r.payload.entities))?r.payload.entities:[];
       const filtered=((r.payload&&r.payload.explanations)||[]).some(x=>/LICENS/i.test(x.code||''));
       spotifyHits=ents.filter(e=>!e.playback||e.playback.status!=='NOT_PLAYABLE').map(e=>({name:e.name,by:(e.creators||[]).map(c=>c.name).join(', '),type:e.entity_type,url:e.url}));
       return {results:spotifyHits.map(h=>({name:h.name,by:h.by,type:h.type})),someResultsHiddenForLicensing:filtered,note:'TALK = podcast episode, COLLECTION = album or playlist, CREATOR = artist, MUSIC = song'};
     }}''', '''       const r=await mcp.callTool('Spotify','search',{prompt:String(inp.query||'').slice(0,300)},{signal:ctx.signal});
       const ents=(r.payload&&Array.isArray(r.payload.entities))?r.payload.entities:[];
       spotifyHits=ents.map(e=>({name:e.name,by:(e.creators||[]).map(c=>c.name).join(', '),type:e.entity_type,kind:e.kind,url:e.url,uri:e.uri}));
       return {results:spotifyHits.map(h=>({name:h.name,by:h.by,kind:h.kind,uri:h.uri}))};
     }},
    {name:'spotify_play',description:'Start playing something on Courtney\\'s Spotify (her iPad, phone or a speaker). Pass a uri from spotify_find. Use it whenever she asks you to play something.',
     inputSchema:{type:'object',properties:{uri:{type:'string',description:'spotify: uri from spotify_find'},device:{type:'string',description:'Optional device name, e.g. "iPad" or "Kitchen speaker"'}},required:['uri']},
     async execute(inp,ctx){
       bubble.textContent='Starting it on Spotify…';
       try{ const r=await mcp.callTool('Spotify','play',{uri:inp.uri,device:inp.device},{signal:ctx.signal}); spotifyPlayed=true; return r.payload; }
       catch(e){ return {error:e.code||'failed',hint:e.code==='no_device'?'Ask her to open Spotify on the iPad once, then try again.':e.code==='spotify_not_linked'?'Spotify is not linked yet: Settings → Link Spotify.':e.code==='premium_required'?'Playback control needs Spotify Premium.':''}; }
     }},
    {name:'spotify_control',description:'Control what is playing on Spotify: pause, resume, next, previous, volume (percent), or now (what is playing).',
     inputSchema:{type:'object',properties:{op:{type:'string',enum:['pause','resume','next','previous','volume','now']},percent:{type:'number'}},required:['op']},
     async execute(inp,ctx){
       try{ const r=await mcp.callTool('Spotify',String(inp.op),{percent:inp.percent},{signal:ctx.signal}); if(inp.op!=='now') spotifyPlayed=true; return r.payload; }
       catch(e){ return {error:e.code||'failed'}; }
     }}''')
rep("let spotifyHits=null, salesUnsub=null, salesDay=null;", "let spotifyHits=null, spotifyPlayed=false, salesUnsub=null, salesDay=null;")
rep("  spotifyHits=null;\n", "  spotifyHits=null; spotifyPlayed=false;\n")
rep("""const hit=spotifyHits&&spotifyHits.find(h=>/^https:\\/\\/open\\.spotify\\.com\\//.test(h.url||'')&&h.type!=='TALK'&&(!words.length||words.some(w=>(h.name+' '+h.by).toLowerCase().includes(w))));""",
"""const hit=!spotifyPlayed&&spotifyHits&&spotifyHits.find(h=>h.uri&&h.type!=='TALK'&&(!words.length||words.some(w=>(h.name+' '+h.by).toLowerCase().includes(w))));""")
rep('''(hit?`<a class="playlink" href="${esc(hit.url)}" target="_blank" rel="noopener"><svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M3 1.8v8.4L10 6z"/></svg>Play ${esc(hit.name)}${hit.by?' · '+esc(hit.by):''} on Spotify</a>`:'')''',
'''(hit?`<button type="button" class="playlink" data-spplay="${esc(hit.uri)}"><svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M3 1.8v8.4L10 6z"/></svg>Play ${esc(hit.name)}${hit.by?' · '+esc(hit.by):''}</button>`:'')''')
rep("""spotify_find (find songs, artists, playlists or podcasts on Spotify). You cannot start playback yourself (the Spotify connection can't press play), so when she asks you to play something, find it and say a Play button is ready. If the exact song isn't in the results and someResultsHiddenForLicensing is true, tell her Spotify restricts that track for connected apps and suggest asking Siri to play it; never offer a podcast episode or cover as a substitute unless she asks.""",
"""spotify_find (find songs, artists, albums, playlists or podcasts on Spotify), spotify_play (actually start playing a result on her iPad, phone or speaker) and spotify_control (pause, resume, skip, volume, what's playing). When she asks you to play something, find it, then play the best match right away and say what's playing in a few words. If nothing matches what she asked for, say so; never substitute a podcast or cover unless she asks. If playback fails with no_device, tell her to open Spotify on the iPad once and ask again.""")

# ---------- copy: no more "claude.ai account" language ----------
s = s.replace('Open it from your claude.ai account.', 'Sign in to Ether to use this.').replace('Open Ether from your claude.ai account to see your calendar.', 'Add your calendar links in Ether’s settings to see your schedule.')
rep("const n=NODES.find(x=>x.id===sec)||{title:sec==='log'?'Conversation':sec==='voice'?'Settings':'Ether'};",
    "const n=NODES.find(x=>x.id===sec)||{title:sec==='log'?'Conversation':sec==='voice'?'Settings':'Ether'}; if(sec==='voice'&&window.etherRenderSettings) etherRenderSettings();")

# ---------- Settings drawer: voice, wake word, notifications, Spotify, import ----------
rep('''        <div class="ph"><h2 id="voice-h">Ether’s voice</h2><span class="label">This device</span></div>
        <div class="cyc-form" style="margin-top:0">
          <div class="frow"><label for="voice-sel">Voice</label><select id="voice-sel" style="max-width:100%"></select></div>''',
'''        <div class="ph"><h2 id="voice-h">Ether’s voice</h2><span class="label">This device</span></div>
        <div class="cyc-form" style="margin-top:0">
          <div class="frow"><label for="voice-provider">Voice type</label><select id="voice-provider"><option value="natural">Natural (Ether’s own voice)</option><option value="device">Device voices (free, offline)</option></select></div>
          <div class="frow" id="ai-voice-row"><label for="ai-voice">Natural voice</label><select id="ai-voice"></select></div>
          <div class="frow" id="dev-voice-row"><label for="voice-sel">Device voice</label><select id="voice-sel" style="max-width:100%"></select></div>''')
rep('''        <p class="foot">Want a far more natural voice? On the iPad, go to Settings → Accessibility → Spoken Content → Voices → English, download a voice marked Enhanced or Premium (Ava, Zoe or Evan are good), then reopen Ether and pick it here.</p>
      </section>''', '''        <p class="foot">Natural voice works whenever Ether is online. Device voices are the backup; for a better one, download an Enhanced or Premium voice in iPad Settings → Accessibility → Spoken Content → Voices.</p>
      </section>
      <section class="panel" aria-labelledby="wake-h">
        <div class="ph"><h2 id="wake-h">Wake word</h2><span class="label" id="wake-state">Off</span></div>
        <div class="row"><label class="tog"><input type="checkbox" id="wake-on"> <span>Listen for “<span id="wake-label">Hey Jarvis</span>” while Ether is open</span></label></div>
        <div class="cyc-form"><div class="frow"><label for="wake-th">Sensitivity <output id="wake-th-out">0.50</output></label><input type="range" id="wake-th" min="0.3" max="0.8" step="0.05" value="0.5"></div></div>
        <p class="foot">Listening happens on the iPad itself; nothing is sent anywhere until you’ve said the wake word. The mic pauses while Ether talks.</p>
      </section>
      <section class="panel" aria-labelledby="notif-h">
        <div class="ph"><h2 id="notif-h">Notifications</h2><span class="label" id="notif-state"></span></div>
        <div class="row"><button type="button" class="btn" id="notif-on">Turn on for this device</button><button type="button" class="btn ghost" id="notif-test">Send a test</button></div>
        <p class="foot" id="notif-foot">Good-morning summary at 6:42, a midday check on weekdays, a close-the-day reminder at 8:30 and your Sunday reset. On iPad and iPhone, Ether has to be added to the Home Screen first.</p>
      </section>
      <section class="panel" aria-labelledby="conn-h">
        <div class="ph"><h2 id="conn-h">Connections</h2></div>
        <ul class="conn" id="conn"></ul>
        <div class="row"><button type="button" class="btn" id="sp-link">Link Spotify</button></div>
      </section>
      <section class="panel" aria-labelledby="bookl-h">
        <div class="ph"><h2 id="bookl-h">Booking link</h2><span class="label" id="bk-state"></span></div>
        <p class="foot" style="margin-top:0">Send this to anyone who should book a 60-minute working session with you. They only see open times: weekday evenings 5:30–7:30 and Saturdays 10–2, minus anything on your calendar.</p>
        <div class="row"><input id="bk-url" readonly style="flex:1;min-width:0"><button type="button" class="btn" id="bk-copy">Copy link</button></div>
        <div class="row"><button type="button" class="btn ghost" id="bk-google">Connect Google Calendar</button><a class="btn ghost" href="/book" target="_blank" rel="noopener">Preview page</a></div>
      </section>
      <section class="panel" aria-labelledby="acct-h">
        <div class="ph"><h2 id="acct-h">Account</h2><span class="label" id="acct-email"></span></div>
        <div class="row"><label class="btn ghost" for="import-file" style="cursor:pointer">Import from the Claude version</label><input type="file" id="import-file" accept="application/json,.json" hidden><button type="button" class="btn ghost" id="sign-out">Sign out</button></div>
        <p class="foot" id="import-state"></p>
      </section>''')
rep('''<button type="button" class="mini" data-open="voice">Voice &amp; display</button>''', '''<button type="button" class="mini" data-open="voice">Settings</button>''')

# ---------- hooks the app shell (app.js) uses ----------
rep("scheduleHud();\n\n})();", "scheduleHud();\nwindow.etherHooks={stopSpeak,setCaption,speakSeq,openDrawer,runBriefing,say,burstAt};\ndocument.dispatchEvent(new CustomEvent('ether-hooks'));\n})();")

pathlib.Path('public/index.html').write_text(s)
print('wrote public/index.html', len(s), 'bytes')
