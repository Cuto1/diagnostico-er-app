(function(){
'use strict';

const GAME_NAMES={chess:'♟️ Xadrez',checkers:'🔴 Dama',domino:'🁫 Dominó'};
const GAME_DB_NAMES={Chess:'chess',Checkers:'checkers',Domino:'domino'};
const COMP_MODES=new Set(['Sword','Chess','Checkers','Domino']);
let G={type:null,kind:null,mode:'online',state:null,selected:null,legal:[],aiLevel:'medium',startedAt:0,timer:null,clock:null,online:null,poll:null,submitted:false,dominoChoice:null};
let ChessClass=null;
let activityStatus={games:[],sword:{}};
let overviewPoll=null;
let pendingInvite=null;

function el(id){return document.getElementById(id)}
function gameName(t){const key={chess:'Chess',checkers:'Checkers',domino:'Domino'}[t];try{const custom=typeof currentLayoutConfig!=='undefined'&&key?currentLayoutConfig?.exam_cards?.[key]?.title:'';if(custom)return custom}catch(e){}return GAME_NAMES[t]||t}
function gameRpc(name,body){
  return protectedApi('/rest/v1/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})}).then(async r=>{
    let data={};try{data=await r.json()}catch(e){}
    if(!r.ok)throw new Error(data.message||data.error||'Falha na partida');
    return data;
  });
}
function err(e){const raw=String(e&&e.message||e||'Erro');try{const j=JSON.parse(raw);return j.message||j.error||raw}catch(x){}return raw.replace(/^Error:\s*/,'').slice(0,220)}
function fmtClock(ms){ms=Math.max(0,Number(ms)||0);const s=Math.ceil(ms/1000),m=Math.floor(s/60),r=s%60;return String(m).padStart(2,'0')+':'+String(r).padStart(2,'0')}
function esc2(s){return typeof esc==='function'?esc(String(s??'')):String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function stopLocalTimer(){if(G.timer){clearInterval(G.timer);G.timer=null}}
function stopGamePoll(){if(G.poll){clearInterval(G.poll);G.poll=null}}
function resetRuntime(){stopLocalTimer();stopGamePoll();G={type:null,kind:null,mode:'online',state:null,selected:null,legal:[],aiLevel:'medium',startedAt:0,timer:null,clock:null,online:null,poll:null,submitted:false,dominoChoice:null}}
function currentGameScreen(){return el('ergames')&&el('ergames').classList.contains('active')}
function content(){return el('erGamesContent')}
function setTitle(t){if(el('erGamesTitle'))el('erGamesTitle').textContent=t;if(el('erGamesToolbar'))el('erGamesToolbar').textContent=G.kind==='solo'?'Treino':'Competição'}
function gameBack(){stopLocalTimer();stopGamePoll();G.selected=null;G.legal=[];renderGameMenu(G.type||'chess')}
window.erGamesBack=function(){if(G.kind||G.state){gameBack()}else show('home')};

async function loadChess(){
  if(ChessClass)return ChessClass;
  try{
    const mod=await import('https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm');
    ChessClass=mod.Chess;
    return ChessClass;
  }catch(e){
    showAppToast('Xadrez','Não foi possível carregar o motor de regras. Conecte-se à internet e tente novamente.');
    throw e;
  }
}

function renderGameMenu(type){
  resetRuntime();G.type=type;setTitle(gameName(type));
  const note=type==='chess'?'No online e no campeonato o relógio é obrigatório. Contra a IA ele é opcional.':type==='domino'?'Solo: você joga contra 1 a 3 adversários controlados pela IA. Online: de 2 a 4 Embaixadores.':'Captura obrigatória, múltiplas capturas e promoção para dama.';
  content().innerHTML=
    '<div class="card game-hero"><strong>🎮 JOGOS E.R.</strong><h2 style="margin:6px 0">'+gameName(type)+'</h2><p>'+note+'</p></div>'+
    '<div class="game-mode-grid">'+
      '<button class="game-mode-btn" onclick="startGameSetup(\'solo\')">🤖 Solo contra IA<small>Treino • não conta no ranking</small></button>'+
      '<button class="game-mode-btn" onclick="startGameSetup(\'online\')">🌐 Jogar Online<small>Convide Embaixadores conectados</small></button>'+
      '<button class="game-mode-btn" onclick="startGameSetup(\'championship\')">🏆 Campeonato<small>Partida competitiva registrada</small></button>'+
    '</div>'+
    '<div class="card"><strong>Como funciona</strong><p class="game-note" style="margin-bottom:0">Partidas contra IA entram no seu Status como treino. Online e Campeonato entram no Ranking competitivo.</p></div>';
}
window.openERGame=async function(type){
  if(!currentUser()){show('auth');return}
  show('ergames');G.type=type;renderGameMenu(type);
  if(navigator.onLine){
    try{
      const ov=await gameRpc('get_my_er_game_overview',{});
      const cur=ov?.current;
      if(cur&&cur.status==='active'){
        G.online={matchId:cur.match_id};G.type=cur.game_type;G.kind='online';
        await loadOnlineGame(true);
      }
    }catch(e){}
  }
};

window.startGameSetup=function(kind){
  G.kind=kind;G.mode=kind==='championship'?'championship':'online';G.selected=null;G.legal=[];
  if(kind==='solo')renderSoloSetup();else renderOnlineSetup();
};

function onlineCandidatesHtml(need,max){
  const users=(typeof onlineUsers!=='undefined'?onlineUsers:[]).filter(u=>!u.is_me);
  if(!users.length)return '<div class="empty">Nenhum outro Embaixador online agora.</div>';
  return users.map(u=>'<label class="game-opponent"><input type="checkbox" name="gameOpp" value="'+esc2(u.id)+'"><span><strong>'+esc2(u.name||'Embaixador')+'</strong><small style="display:block;color:#6d83a1">'+esc2(u.group||'')+'</small></span></label>').join('');
}

function renderSoloSetup(){
  setTitle(gameName(G.type));
  if(G.type==='chess'){
    content().innerHTML='<div class="card"><h3 style="margin-top:0">♟️ Xadrez contra IA</h3>'+
      '<div class="game-setup-grid"><div class="field"><label>DIFICULDADE</label><select id="gameAiLevel"><option value="easy">Iniciante</option><option value="medium" selected>Médio</option><option value="hard">Difícil</option></select></div>'+
      '<div class="field"><label>RELÓGIO</label><select id="gameSoloClock"><option value="0">Sem relógio</option><option value="300">5 min</option><option value="600">10 min</option><option value="900">15 min</option><option value="1800">30 min</option></select></div></div>'+
      '<div class="field" style="margin-top:9px"><label>INCREMENTO POR JOGADA</label><select id="gameSoloInc"><option value="0">Sem incremento</option><option value="2">+2 s</option><option value="5">+5 s</option><option value="10">+10 s</option></select></div>'+
      '<button class="btn primary block" style="margin-top:12px" onclick="startSoloGame()">Começar</button></div>';
  }else if(G.type==='checkers'){
    content().innerHTML='<div class="card"><h3 style="margin-top:0">🔴 Dama contra IA</h3><div class="field"><label>DIFICULDADE</label><select id="gameAiLevel"><option value="easy">Iniciante</option><option value="medium" selected>Médio</option><option value="hard">Difícil</option></select></div><button class="btn primary block" style="margin-top:12px" onclick="startSoloGame()">Começar</button></div>';
  }else{
    content().innerHTML='<div class="card"><h3 style="margin-top:0">🁫 Dominó contra IA</h3>'+
      '<div class="game-setup-grid"><div class="field"><label>JOGADORES NA MESA</label><select id="dominoSoloPlayers" onchange="toggleDominoTeamSolo()"><option value="2">2 (você + 1 IA)</option><option value="3">3 (você + 2 IAs)</option><option value="4">4 (você + 3 IAs)</option></select></div>'+
      '<div class="field"><label>DIFICULDADE</label><select id="gameAiLevel"><option value="easy">Iniciante</option><option value="medium" selected>Médio</option><option value="hard">Difícil</option></select></div></div>'+
      '<label id="dominoSoloTeamRow" class="game-opponent hidden" style="margin-top:10px"><input id="dominoSoloTeams" type="checkbox"><span><strong>Jogar em duplas</strong><small style="display:block;color:#6d83a1">Você e a IA do assento 3 contra as outras duas IAs.</small></span></label>'+
      '<button class="btn primary block" style="margin-top:12px" onclick="startSoloGame()">Começar</button></div>';
  }
}
window.toggleDominoTeamSolo=function(){const row=el('dominoSoloTeamRow');if(row)row.classList.toggle('hidden',Number(el('dominoSoloPlayers').value)!==4)};

function renderOnlineSetup(){
  setTitle(gameName(G.type));
  const isDom=G.type==='domino',title=G.mode==='championship'?'🏆 Modo Campeonato':'🌐 Partida Online';
  let settings='';
  if(G.type==='chess')settings='<div class="game-setup-grid"><div class="field"><label>RELÓGIO</label><select id="gameClockBase"><option value="300">5 min</option><option value="600" selected>10 min</option><option value="900">15 min</option><option value="1800">30 min</option></select></div><div class="field"><label>INCREMENTO</label><select id="gameClockInc"><option value="0">0 s</option><option value="2">+2 s</option><option value="5">+5 s</option><option value="10">+10 s</option></select></div></div>';
  if(isDom)settings='<div class="game-setup-grid"><div class="field"><label>PARTICIPANTES</label><select id="gamePlayerLimit" onchange="renderGameOppSelection()"><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></div><div class="field"><label>FORMATO</label><select id="gameTeamMode"><option value="0">Cada um por si</option><option value="1">Duplas (somente 4)</option></select></div></div>';
  content().innerHTML='<div class="card"><h3 style="margin-top:0">'+title+' • '+gameName(G.type)+'</h3>'+settings+
    '<p class="game-note">Selecione os participantes que estão online. O convite precisa ser aceito antes da partida.</p><div id="gameOppSelection" class="game-opponents"></div>'+
    '<button class="btn primary block" onclick="createOnlineGame()">Enviar convite</button></div>';
  renderGameOppSelection();
}
window.renderGameOppSelection=function(){
  const box=el('gameOppSelection');if(!box)return;
  const selected=new Set([...box.querySelectorAll('input[name="gameOpp"]:checked')].map(x=>x.value));
  const total=G.type==='domino'?Number(el('gamePlayerLimit')?.value||2):2,need=total-1;
  box.innerHTML='<div class="muted" style="font-size:10px">Selecione exatamente '+need+' adversário(s).</div>'+onlineCandidatesHtml(need,total);
  box.querySelectorAll('input[name="gameOpp"]').forEach(x=>{if(selected.has(x.value))x.checked=true});
  if(el('gameTeamMode'))el('gameTeamMode').disabled=total!==4;
};
window.createOnlineGame=async function(){
  const total=G.type==='domino'?Number(el('gamePlayerLimit')?.value||2):2;
  const ids=[...document.querySelectorAll('#gameOppSelection input[name="gameOpp"]:checked')].map(x=>x.value);
  if(ids.length!==total-1){showAppToast('Jogos E.R.','Selecione exatamente '+(total-1)+' adversário(s).');return}
  const settings={};
  if(G.type==='chess'){settings.time_base_sec=Number(el('gameClockBase').value);settings.increment_sec=Number(el('gameClockInc').value)}
  if(G.type==='domino')settings.team_mode=total===4&&el('gameTeamMode').value==='1';
  try{
    const data=await gameRpc('create_er_game_match',{p_game_type:G.type,p_opponent_user_ids:ids,p_mode:G.mode,p_settings:settings});
    G.kind='online';G.online={matchId:data.match_id};await loadOnlineGame(true);startOnlinePoll();showAppToast('Convite enviado','Aguardando os participantes aceitarem.');
  }catch(e){showAppToast('Jogos E.R.',err(e))}
};

async function startSoloGame(){
  G.aiLevel=el('gameAiLevel')?.value||'medium';G.kind='solo';G.startedAt=Date.now();
  if(G.type==='chess')await startSoloChess();
  else if(G.type==='checkers')startSoloCheckers();
  else startSoloDomino();
}
window.startSoloGame=startSoloGame;

async function recordSolo(result){
  try{await gameRpc('record_er_solo_game_result',{p_game_type:G.type,p_result:result,p_difficulty:G.aiLevel,p_duration_ms:Date.now()-G.startedAt})}catch(e){}
}
function resultScreen(result,text){
  stopLocalTimer();const icon=result==='win'?'🏆':result==='loss'?'🤖':'🤝';
  content().innerHTML='<div class="card game-result"><div class="big">'+icon+'</div><h2>'+text+'</h2><p class="muted">'+(G.kind==='solo'?'Resultado registrado como treino.':'Resultado registrado na partida competitiva.')+'</p><div class="game-actions"><button class="btn" onclick="openERGame(\''+G.type+'\')">Voltar</button>'+(G.kind==='solo'?'<button class="btn primary" onclick="startGameSetup(\'solo\')">Jogar novamente</button>':'')+'</div></div>';
}

/* XADREZ */
const CHESS_SYMBOLS={wp:'♟︎',wn:'♞︎',wb:'♝︎',wr:'♜︎',wq:'♛︎',wk:'♚︎',bp:'♟︎',bn:'♞︎',bb:'♝︎',br:'♜︎',bq:'♛︎',bk:'♚︎'};
function chessCastleMoves(chess,color){
  if(chess.turn()!==color)return[];
  const kingSq=color==='w'?'e1':'e8';
  return chess.moves({square:kingSq,verbose:true}).filter(m=>String(m.flags||'').includes('k')||String(m.flags||'').includes('q')||m.san==='O-O'||m.san==='O-O-O');
}
function chessMoveIsCastle(m){return String(m?.flags||'').includes('k')||String(m?.flags||'').includes('q')||m?.san==='O-O'||m?.san==='O-O-O'}
async function startSoloChess(){
  const Chess=await loadChess();const chess=new Chess(),base=Number(el('gameSoloClock')?.value||0),inc=Number(el('gameSoloInc')?.value||0);
  G.state={chess,userColor:'w'};G.clock=base?{w:base*1000,b:base*1000,inc:inc*1000,last:Date.now(),running:'w'}:null;
  renderChess();if(G.clock)startSoloChessClock();
}
function startSoloChessClock(){
  stopLocalTimer();G.timer=setInterval(()=>{
    if(!G.clock||!G.state?.chess)return;
    const now=Date.now(),d=now-G.clock.last;G.clock.last=now;G.clock[G.clock.running]=Math.max(0,G.clock[G.clock.running]-d);
    if(G.clock[G.clock.running]<=0){const human=G.clock.running==='w';recordSolo(human?'loss':'win');resultScreen(human?'loss':'win',human?'Seu tempo acabou.':'A IA perdeu por tempo.');return}
    updateChessClocks();
  },200);
}
function updateChessClocks(){if(el('clockW'))el('clockW').textContent=fmtClock(G.clock?.w||0);if(el('clockB'))el('clockB').textContent=fmtClock(G.clock?.b||0)}
function chessEval(chess){
  const vals={p:100,n:320,b:330,r:500,q:900,k:0};let s=0;
  chess.board().forEach(row=>row.forEach(p=>{if(p)s+=(p.color==='b'?1:-1)*vals[p.type]}));return s;
}
function chessAiPick(chess,level){
  const moves=chess.moves({verbose:true});if(!moves.length)return null;
  if(level==='easy')return moves[Math.floor(Math.random()*moves.length)];
  let best=null,bestScore=-Infinity;
  for(const m of moves){chess.move(m);let sc=chessEval(chess)+(m.captured?80:0)+(m.promotion?700:0);
    if(level==='hard'&&!chess.isGameOver()){
      let worst=Infinity;for(const r of chess.moves({verbose:true}).slice(0,36)){chess.move(r);worst=Math.min(worst,chessEval(chess));chess.undo()}sc=worst;
    }
    chess.undo();if(sc>bestScore){bestScore=sc;best=m}
  }return best||moves[0];
}
function chessFinished(chess,moverColor){
  if(!chess.isGameOver())return null;
  if(chess.isCheckmate())return {winner:moverColor,reason:'xeque-mate'};
  return {winner:null,reason:'empate'};
}
function renderChess(onlineState){
  const online=G.kind==='online',chess=G.state.chess,meSeat=online?onlineState.players.find(p=>p.is_me)?.seat:0,orientation=meSeat===1?'b':'w';
  const myColor=meSeat===1?'b':'w',canMove=online?(onlineState.status==='active'&&onlineState.current_turn_seat===meSeat&&chess.turn()===myColor):(chess.turn()==='w');
  const board=chess.board(),ranks=orientation==='w'?[0,1,2,3,4,5,6,7]:[7,6,5,4,3,2,1,0],files=orientation==='w'?[0,1,2,3,4,5,6,7]:[7,6,5,4,3,2,1,0];
  let clocks='';
  if(online){const ps=onlineState.players||[];clocks='<div class="game-score-row">'+ps.map(p=>'<div class="game-player-chip '+(p.seat===onlineState.current_turn_seat?'active':'')+'"><strong>'+esc2(p.name)+(p.is_me?' • você':'')+'</strong><span class="game-clock">'+fmtClock(p.clock_ms)+'</span></div>').join('')+'</div>'}
  else if(G.clock)clocks='<div class="game-score-row"><div class="game-player-chip '+(chess.turn()==='w'?'active':'')+'"><strong>Você • Brancas</strong><span id="clockW" class="game-clock">'+fmtClock(G.clock.w)+'</span></div><div class="game-player-chip '+(chess.turn()==='b'?'active':'')+'"><strong>IA • Pretas</strong><span id="clockB" class="game-clock">'+fmtClock(G.clock.b)+'</span></div></div>';
  let squares='';
  for(const ri of ranks)for(const fi of files){
    const sq=String.fromCharCode(97+fi)+(8-ri),p=board[ri][fi],isSel=G.selected===sq,legal=G.legal.find(m=>m.to===sq),isCheck=p?.type==='k'&&p.color===chess.turn()&&chess.inCheck();
    const piece=p?'<span class="chess-piece '+(p.color==='w'?'white':'black')+'">'+CHESS_SYMBOLS[p.color+p.type]+'</span>':'';
    const extra=(isSel?' selected':'')+(legal?' '+(legal.captured?'capture':'legal'):'')+(isCheck?' in-check':'');
    squares+='<button class="game-square '+(((ri+fi)%2)?'dark':'light')+extra+'" data-square="'+sq+'" onclick="clickChessSquare(\''+sq+'\')">'+piece+'</button>';
  }
  const status=online?(onlineState.status==='active'?(onlineState.current_turn_seat===meSeat?'Sua vez':'Vez de '+esc2(onlineState.players.find(p=>p.seat===onlineState.current_turn_seat)?.name||'adversário')):'Partida encerrada'):(chess.turn()==='w'?'Sua vez':'IA pensando...');
  const castles=canMove?chessCastleMoves(chess,myColor):[];
  const castleBtns=castles.length?'<div class="chess-special-actions"><span>Jogada especial disponível:</span>'+castles.map(m=>'<button class="btn gold" onclick="performChessCastle(\''+(m.san==='O-O-O'||String(m.flags||'').includes('q')?'queen':'king')+'\')">'+(m.san==='O-O-O'||String(m.flags||'').includes('q')?'Roque grande':'Roque pequeno')+'</button>').join('')+'</div>':'';
  content().innerHTML='<div class="card chess-card">'+clocks+'<div class="game-board-wrap"><div class="game-board">'+squares+'</div><div class="chess-board-caption"><span>'+(orientation==='w'?'Brancas':'Pretas')+'</span><span>Toque na peça e depois na casa de destino.</span></div></div><div class="game-status">'+status+(chess.inCheck()?' • XEQUE':'')+'</div>'+castleBtns+'<div class="game-actions"><button class="btn" onclick="'+(online?'leaveOnlineGame()':'openERGame(\'chess\')')+'">Sair</button></div></div>';
  updateChessClocks();
}

window.performChessCastle=async function(side){
  const chess=G.state?.chess;if(!chess)return;
  const online=G.kind==='online',st=G.online?.state,meSeat=online?st.players.find(p=>p.is_me)?.seat:0,myColor=meSeat===1?'b':'w';
  if(online&&(st.status!=='active'||st.current_turn_seat!==meSeat))return;
  if(!online&&chess.turn()!=='w')return;
  if(chess.turn()!==myColor)return;
  const kingSq=myColor==='w'?'e1':'e8',target=side==='queen'?(myColor==='w'?'c1':'c8'):(myColor==='w'?'g1':'g8');
  const legal=chess.moves({square:kingSq,verbose:true}),castle=legal.find(m=>m.to===target&&chessMoveIsCastle(m));
  if(!castle){showAppToast('Xadrez','O roque não está disponível nesta posição. Verifique se o rei ou a torre já se moveram, se há peças no caminho ou se alguma casa está sob ataque.');return}
  G.selected=kingSq;G.legal=legal;await window.clickChessSquare(target);
};

function chooseChessPromotion(color){
  return new Promise(resolve=>{
    const old=el('chessPromotionModal');if(old)old.remove();
    const box=document.createElement('div');box.id='chessPromotionModal';box.className='chess-promotion-modal';
    const options=[
      ['q','Dama',color==='w'?'♛︎':'♛︎'],
      ['r','Torre',color==='w'?'♜︎':'♜︎'],
      ['b','Bispo',color==='w'?'♝︎':'♝︎'],
      ['n','Cavalo',color==='w'?'♞︎':'♞︎']
    ];
    box.innerHTML='<div class="chess-promotion-card"><strong>Promover peão para:</strong><p>Escolha a peça antes de concluir a jogada.</p><div class="chess-promotion-options">'+options.map(o=>'<button type="button" data-piece="'+o[0]+'"><span class="chess-piece '+(color==='w'?'white':'black')+'">'+o[2]+'</span><b>'+o[1]+'</b></button>').join('')+'</div><button type="button" class="btn block" data-cancel="1">Cancelar</button></div>';
    document.body.appendChild(box);
    const finish=v=>{if(box.isConnected)box.remove();resolve(v)};
    box.querySelectorAll('[data-piece]').forEach(btn=>btn.onclick=()=>finish(btn.dataset.piece));
    box.querySelector('[data-cancel]').onclick=()=>finish(null);
    box.onclick=e=>{if(e.target===box)finish(null)};
  });
}

window.clickChessSquare=async function(sq){
  const chess=G.state?.chess;if(!chess)return;
  const online=G.kind==='online',st=G.online?.state,meSeat=online?st.players.find(p=>p.is_me)?.seat:0,myColor=meSeat===0?'w':'b';
  if(online&&(st.status!=='active'||st.current_turn_seat!==meSeat))return;
  if(!online&&chess.turn()!=='w')return;
  if(chess.turn()!==myColor)return;
  const piece=chess.get(sq);
  if(!G.selected){
    if(piece&&piece.color===myColor){G.selected=sq;G.legal=chess.moves({square:sq,verbose:true});renderChess(online?st:undefined)}
    return;
  }
  const target=G.legal.find(m=>m.to===sq);
  if(!target){G.selected=null;G.legal=[];if(piece&&piece.color===myColor){G.selected=sq;G.legal=chess.moves({square:sq,verbose:true})}renderChess(online?st:undefined);return}
  const from=G.selected,mover=chess.turn(),movingPiece=chess.get(from);
  if(movingPiece?.type==='p'&&(sq.endsWith('8')||sq.endsWith('1'))){
    const promotion=await chooseChessPromotion(mover);
    if(!promotion){renderChess(online?st:undefined);return}
    chess.move({from,to:sq,promotion});
  }else{
    chess.move({from,to:sq});
  }
  G.selected=null;G.legal=[];
  const fin=chessFinished(chess,mover);
  if(online){
    try{
      const next=st.current_turn_seat===0?1:0,winner=fin?.winner?currentUid():null;
      const data=await gameRpc('submit_er_board_game_state',{p_match_id:st.match_id,p_expected_version:st.version,p_state:{fen:chess.fen()},p_next_turn_seat:next,p_finished:!!fin,p_winner_user_id:winner,p_reason:fin?.reason||null});
      applyOnlineState(data);
    }catch(e){showAppToast('Xadrez',err(e));await loadOnlineGame(true)}
    return;
  }
  if(G.clock){G.clock.w+=G.clock.inc;G.clock.running='b';G.clock.last=Date.now()}
  if(fin){await recordSolo(fin.winner==='w'?'win':'draw');resultScreen(fin.winner==='w'?'win':'draw',fin.winner==='w'?'Xeque-mate! Você venceu.':'Partida empatada.');return}
  renderChess();setTimeout(chessAiTurn,300);
};
async function chessAiTurn(){
  const chess=G.state?.chess;if(!chess||chess.turn()!=='b')return;
  const m=chessAiPick(chess,G.aiLevel);if(!m)return;const mover='b';chess.move(m);
  if(G.clock){G.clock.b+=G.clock.inc;G.clock.running='w';G.clock.last=Date.now()}
  const fin=chessFinished(chess,mover);
  if(fin){await recordSolo(fin.winner==='b'?'loss':'draw');resultScreen(fin.winner==='b'?'loss':'draw',fin.winner==='b'?'Xeque-mate. A IA venceu.':'Partida empatada.');return}
  renderChess();
}

/* DAMA */
function checkersStart(){
  const b=Array.from({length:8},()=>Array(8).fill(null));
  for(let r=0;r<3;r++)for(let c=0;c<8;c++)if((r+c)%2===1)b[r][c]='b';
  for(let r=5;r<8;r++)for(let c=0;c<8;c++)if((r+c)%2===1)b[r][c]='r';
  return b;
}
function cloneBoard(b){return b.map(r=>r.slice())}
function ckOwner(p){return !p?null:(p.toLowerCase()==='r'?0:1)}
function ckCapturesFrom(b,r,c,player){
  const p=b[r]?.[c];if(!p||ckOwner(p)!==player)return[];const out=[],king=p===p.toUpperCase();
  for(const [dr,dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]){
    if(!king){
      const mr=r+dr,mc=c+dc,tr=r+2*dr,tc=c+2*dc;
      if(tr>=0&&tr<8&&tc>=0&&tc<8&&b[mr]?.[mc]&&ckOwner(b[mr][mc])!==player&&!b[tr][tc])out.push({from:[r,c],to:[tr,tc],capture:[mr,mc]});
      continue;
    }
    let rr=r+dr,cc=c+dc,enemy=null;
    while(rr>=0&&rr<8&&cc>=0&&cc<8){
      if(!b[rr][cc]){if(enemy)out.push({from:[r,c],to:[rr,cc],capture:enemy});rr+=dr;cc+=dc;continue}
      if(ckOwner(b[rr][cc])===player||enemy)break;
      enemy=[rr,cc];rr+=dr;cc+=dc;
    }
  }
  return out;
}
function ckMoves(b,player,forced){
  if(forced)return ckCapturesFrom(b,forced[0],forced[1],player);
  let caps=[];for(let r=0;r<8;r++)for(let c=0;c<8;c++)caps=caps.concat(ckCapturesFrom(b,r,c,player));if(caps.length)return caps;
  const out=[];for(let r=0;r<8;r++)for(let c=0;c<8;c++){const p=b[r][c];if(!p||ckOwner(p)!==player)continue;const king=p===p.toUpperCase(),dirs=king?[-1,1]:(player===0?[-1]:[1]);for(const dr of dirs)for(const dc of[-1,1]){let tr=r+dr,tc=c+dc;while(tr>=0&&tr<8&&tc>=0&&tc<8&&!b[tr][tc]){out.push({from:[r,c],to:[tr,tc]});if(!king)break;tr+=dr;tc+=dc}}}
  return out;
}
function ckApply(b,m,player){
  const nb=cloneBoard(b),p=nb[m.from[0]][m.from[1]];nb[m.from[0]][m.from[1]]=null;if(m.capture)nb[m.capture[0]][m.capture[1]]=null;let piece=p;if(player===0&&m.to[0]===0)piece='R';if(player===1&&m.to[0]===7)piece='B';nb[m.to[0]][m.to[1]]=piece;return nb;
}
function ckGameOver(b,nextPlayer){const pieces=b.flat().filter(Boolean);if(!pieces.some(p=>ckOwner(p)===nextPlayer)||!ckMoves(b,nextPlayer,null).length)return true;return false}
function renderCheckers(onlineState){
  const online=G.kind==='online',state=G.state,meSeat=online?onlineState.players.find(p=>p.is_me)?.seat:0,orientation=meSeat===1?1:0,rows=orientation?[7,6,5,4,3,2,1,0]:[0,1,2,3,4,5,6,7],cols=orientation?[7,6,5,4,3,2,1,0]:[0,1,2,3,4,5,6,7],turn=online?onlineState.current_turn_seat:state.turn;
  let squares='';for(const r of rows)for(const c of cols){const key=r+','+c,p=state.board[r][c],sel=G.selected===key,legal=G.legal.find(m=>m.to[0]===r&&m.to[1]===c);let piece='';if(p)piece='<span class="checker-piece '+(ckOwner(p)===0?'checker-red':'checker-black')+' '+(p===p.toUpperCase()?'checker-king':'')+'"></span>';squares+='<button class="game-square '+(((r+c)%2)?'dark':'light')+(sel?' selected':'')+(legal?' '+(legal.capture?'capture':'legal'):'')+'" onclick="clickChecker('+r+','+c+')">'+piece+'</button>'}
  const name=online?(turn===meSeat?'Sua vez':'Vez de '+esc2(onlineState.players.find(p=>p.seat===turn)?.name||'adversário')):(turn===0?'Sua vez':'IA pensando...');
  content().innerHTML='<div class="card">'+(online?'<div class="game-score-row">'+onlineState.players.map(p=>'<div class="game-player-chip '+(p.seat===turn?'active':'')+'"><strong>'+esc2(p.name)+(p.is_me?' • você':'')+'</strong></div>').join('')+'</div>':'')+'<div class="game-board-wrap"><div class="game-board">'+squares+'</div></div><div class="game-status">'+name+(state.forced?' • continue capturando':'')+'</div><div class="game-actions"><button class="btn" onclick="'+(online?'leaveOnlineGame()':'openERGame(\'checkers\')')+'">Sair</button></div></div>';
}
function startSoloCheckers(){G.state={board:checkersStart(),turn:0,forced:null};renderCheckers()}
window.clickChecker=async function(r,c){
  const s=G.state,online=G.kind==='online',st=G.online?.state,turn=online?st.current_turn_seat:s.turn,me=online?st.players.find(p=>p.is_me)?.seat:0;if(online&&turn!==me)return;if(!online&&turn!==0)return;
  const key=r+','+c,p=s.board[r][c];
  if(!G.selected){if(p&&ckOwner(p)===turn){const ms=ckMoves(s.board,turn,s.forced).filter(m=>m.from[0]===r&&m.from[1]===c);if(ms.length){G.selected=key;G.legal=ms;renderCheckers(online?st:undefined)}}return}
  const m=G.legal.find(x=>x.to[0]===r&&x.to[1]===c);if(!m){G.selected=null;G.legal=[];renderCheckers(online?st:undefined);return}
  s.board=ckApply(s.board,m,turn);let next=1-turn,forced=null;
  if(m.capture){const again=ckCapturesFrom(s.board,r,c,turn);if(again.length){next=turn;forced=[r,c]}}
  s.turn=next;s.forced=forced;G.selected=null;G.legal=[];
  const fin=!forced&&ckGameOver(s.board,next);
  if(online){
    try{const winner=fin?currentUid():null,data=await gameRpc('submit_er_board_game_state',{p_match_id:st.match_id,p_expected_version:st.version,p_state:{board:s.board,forced:s.forced},p_next_turn_seat:next,p_finished:fin,p_winner_user_id:winner,p_reason:fin?'sem-jogadas':null});applyOnlineState(data)}catch(e){showAppToast('Dama',err(e));loadOnlineGame(true)}return;
  }
  if(fin){await recordSolo('win');resultScreen('win','Você venceu a partida de Dama!');return}
  renderCheckers();if(next===1)setTimeout(checkersAiTurn,350);
};
function ckAiPick(moves,level,b){
  if(level==='easy')return moves[Math.floor(Math.random()*moves.length)];
  let scored=moves.map(m=>({m,s:(m.capture?100:0)+(m.to[0]===7?40:0)+Math.random()*8}));
  if(level==='hard')scored=scored.map(x=>{const nb=ckApply(b,x.m,1),reply=ckMoves(nb,0,null);return{m:x.m,s:x.s-(reply.some(r=>r.capture)?45:0)}});scored.sort((a,b)=>b.s-a.s);return scored[0].m;
}
async function checkersAiTurn(){
  const s=G.state;if(!s||s.turn!==1)return;const moves=ckMoves(s.board,1,s.forced);if(!moves.length){await recordSolo('win');resultScreen('win','A IA ficou sem jogadas. Você venceu!');return}
  const m=ckAiPick(moves,G.aiLevel,s.board);s.board=ckApply(s.board,m,1);let next=0,forced=null;if(m.capture){const again=ckCapturesFrom(s.board,m.to[0],m.to[1],1);if(again.length){next=1;forced=m.to}}
  s.turn=next;s.forced=forced;const fin=!forced&&ckGameOver(s.board,next);if(fin){await recordSolo('loss');resultScreen('loss','A IA venceu a partida de Dama.');return}renderCheckers();if(next===1)setTimeout(checkersAiTurn,320);
}

/* DOMINÓ */
function dominoDeck(){const a=[];for(let i=0;i<=6;i++)for(let j=i;j<=6;j++)a.push([i,j]);for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function domFits(t,l,r){return l==null||t[0]===l||t[1]===l||t[0]===r||t[1]===r}
function domSides(t,l,r){if(l==null)return['right'];const s=[];if(t[0]===l||t[1]===l)s.push('left');if(t[0]===r||t[1]===r)s.push('right');return s}
function domPips(h){return h.reduce((s,t)=>s+t[0]+t[1],0)}
function dominoTileHtml(t,actions,l,r){
  const base='<span>'+t[0]+'</span><span>'+t[1]+'</span>';if(!actions)return '<div class="domino-tile">'+base+'</div>';
  const sides=domSides(t,l,r);return '<div style="display:grid;gap:3px"><div class="domino-tile">'+base+'</div><div style="display:flex;gap:2px">'+(sides.includes('left')?'<button class="mini-btn" onclick="playSoloDomino('+t[0]+','+t[1]+',\'left\')">←</button>':'')+(sides.includes('right')?'<button class="mini-btn" onclick="playSoloDomino('+t[0]+','+t[1]+',\'right\')">→</button>':'')+'</div></div>';
}
function domOrient(t,side,l,r){const[a,b]=t;if(l==null)return{tile:[a,b],left:a,right:b};if(side==='left'){if(b===l)return{tile:[a,b],left:a,right:r};if(a===l)return{tile:[b,a],left:b,right:r}}else{if(a===r)return{tile:[a,b],left:l,right:b};if(b===r)return{tile:[b,a],left:l,right:a}}return null}
function domWinnerBlocked(s){
  if(s.teamMode){const sums=[0,0];s.hands.forEach((h,i)=>sums[i%2]+=domPips(h));return sums[0]===sums[1]?null:(sums[0]<sums[1]?0:1)}
  let min=Infinity,w=null,tie=false;s.hands.forEach((h,i)=>{const v=domPips(h);if(v<min){min=v;w=i;tie=false}else if(v===min)tie=true});return tie?null:w;
}
function startSoloDomino(){
  const n=Number(el('dominoSoloPlayers').value),team=n===4&&!!el('dominoSoloTeams')?.checked,deck=dominoDeck(),hands=Array.from({length:n},()=>[]);
  let best={rank:-1,seat:0};for(let seat=0;seat<n;seat++)for(let j=0;j<7;j++){const t=deck.shift();hands[seat].push(t);const rank=t[0]===t[1]?100+t[0]:t[0]+t[1];if(rank>best.rank)best={rank,seat}}
  G.state={hands,stock:deck,chain:[],left:null,right:null,turn:best.seat,pass:0,teamMode:team,n};renderSoloDomino();if(best.seat!==0)setTimeout(dominoAiLoop,400);
}
function renderSoloDomino(){
  const s=G.state,hand=s.hands[0],can=s.turn===0;
  const players=s.hands.map((h,i)=>'<div class="domino-player-row '+(s.turn===i?'active':'')+'"><span>'+(i===0?'Você':'IA '+i)+(s.teamMode?' • Equipe '+((i%2)+1):'')+'</span><b>'+h.length+' peça(s)</b></div>').join('');
  content().innerHTML='<div class="card domino-table"><strong>🁫 Mesa</strong>'+players+'<div class="domino-chain">'+(s.chain.length?s.chain.map(t=>dominoTileHtml(t,false)).join(''):'<span>Aguardando a primeira peça...</span>')+'</div><div>Monte: '+s.stock.length+'</div></div><div class="card"><strong>Sua mão</strong><div class="domino-hand">'+hand.map(t=>dominoTileHtml(t,can&&domSides(t,s.left,s.right).length,s.left,s.right)).join('')+'</div><div class="game-actions">'+(can&&!hand.some(t=>domFits(t,s.left,s.right))?'<button class="btn primary" onclick="soloDominoDrawPass()">'+(s.stock.length?'Comprar':'Passar')+'</button>':'')+'<button class="btn" onclick="openERGame(\'domino\')">Sair</button></div></div>';
}
window.playSoloDomino=async function(a,b,side){
  const s=G.state;if(!s||s.turn!==0)return;const idx=s.hands[0].findIndex(t=>(t[0]===a&&t[1]===b)||(t[0]===b&&t[1]===a));if(idx<0)return;const o=domOrient([a,b],side,s.left,s.right);if(!o)return;s.hands[0].splice(idx,1);if(side==='left')s.chain.unshift(o.tile);else s.chain.push(o.tile);s.left=o.left;s.right=o.right;s.pass=0;
  if(!s.hands[0].length){await recordSolo('win');resultScreen('win','Você bateu e venceu o Dominó!');return}s.turn=1%s.n;renderSoloDomino();setTimeout(dominoAiLoop,350);
};
window.soloDominoDrawPass=function(){const s=G.state;if(!s||s.turn!==0)return;if(s.hands[0].some(t=>domFits(t,s.left,s.right)))return;if(s.stock.length){s.hands[0].push(s.stock.shift());s.pass=0;renderSoloDomino();return}s.pass++;if(s.pass>=s.n){finishSoloDominoBlocked();return}s.turn=1%s.n;renderSoloDomino();setTimeout(dominoAiLoop,350)};
function domAiPick(hand,l,r,level){const opts=hand.map((t,i)=>({t,i,sides:domSides(t,l,r)})).filter(x=>x.sides.length);if(!opts.length)return null;if(level==='easy')return opts[Math.floor(Math.random()*opts.length)];opts.sort((a,b)=>(b.t[0]+b.t[1])-(a.t[0]+a.t[1]));return opts[0]}
async function dominoAiLoop(){
  const s=G.state;if(!s||s.turn===0)return;const seat=s.turn,hand=s.hands[seat],pick=domAiPick(hand,s.left,s.right,G.aiLevel);
  if(!pick){if(s.stock.length){hand.push(s.stock.shift());s.pass=0;renderSoloDomino();setTimeout(dominoAiLoop,220);return}s.pass++;if(s.pass>=s.n){finishSoloDominoBlocked();return}s.turn=(seat+1)%s.n;renderSoloDomino();if(s.turn!==0)setTimeout(dominoAiLoop,280);return}
  const side=pick.sides[0],o=domOrient(pick.t,side,s.left,s.right);hand.splice(pick.i,1);if(side==='left')s.chain.unshift(o.tile);else s.chain.push(o.tile);s.left=o.left;s.right=o.right;s.pass=0;
  if(!hand.length){const humanWon=s.teamMode?(seat%2===0):seat===0;await recordSolo(humanWon?'win':'loss');resultScreen(humanWon?'win':'loss',humanWon?'Sua equipe venceu!':'A IA venceu o Dominó.');return}
  s.turn=(seat+1)%s.n;renderSoloDomino();if(s.turn!==0)setTimeout(dominoAiLoop,300);
}
async function finishSoloDominoBlocked(){const s=G.state,w=domWinnerBlocked(s),human=w==null?null:(s.teamMode?w===0:w===0),res=w==null?'draw':human?'win':'loss';await recordSolo(res);resultScreen(res,w==null?'Jogo bloqueado: empate.':human?'Jogo bloqueado: você venceu nos pontos.':'Jogo bloqueado: a IA venceu nos pontos.')}

/* ONLINE */
function startOnlinePoll(){stopGamePoll();G.poll=setInterval(()=>{if(currentGameScreen()&&G.online?.matchId)loadOnlineGame(false)},1000)}
async function loadOnlineGame(force){
  if(!G.online?.matchId)return;
  try{const st=await gameRpc('get_er_game_match_state',{p_match_id:G.online.matchId});applyOnlineState(st);startOnlinePoll()}catch(e){if(force)showAppToast('Jogos E.R.',err(e))}
}
function applyOnlineState(st){
  G.online=G.online||{};G.online.matchId=st.match_id;G.online.state=st;G.type=st.game_type;G.kind='online';G.mode=st.mode;setTitle(gameName(G.type));
  if(st.status==='pending'){renderOnlinePending(st);return}
  if(st.status==='finished'||st.status==='declined'||st.status==='expired'||st.status==='cancelled'){renderOnlineFinished(st);return}
  if(G.type==='chess')renderOnlineChess(st);else if(G.type==='checkers')renderOnlineCheckers(st);else renderOnlineDomino(st);
}
function renderOnlinePending(st){
  content().innerHTML='<div class="card game-hero"><strong>'+gameName(st.game_type)+'</strong><h2 style="margin:6px 0">Aguardando participantes</h2><p>'+(st.mode==='championship'?'Modo Campeonato':'Partida Online')+'</p></div><div class="card">'+st.players.map(p=>'<div class="sword-waiting-row"><strong>'+esc2(p.name)+(p.is_me?' • você':'')+'</strong><span class="sword-ready '+(p.accepted?'':'sword-pending')+'">'+(p.accepted?'PRONTO':'AGUARDANDO')+'</span></div>').join('')+'<button class="btn block" style="margin-top:10px" onclick="leaveOnlineGame()">Cancelar</button></div>';
}
async function renderOnlineChess(st){const Chess=await loadChess();const fen=st.state?.fen&&st.state.fen!=='start'?st.state.fen:undefined;try{G.state={chess:new Chess(fen)}}catch(e){G.state={chess:new Chess()}}renderChess(st)}
function renderOnlineCheckers(st){G.state={board:Array.isArray(st.state?.board)?st.state.board:checkersStart(),forced:st.state?.forced||null,turn:st.current_turn_seat};renderCheckers(st)}
function renderOnlineDomino(st){
  G.state=st.state;const me=st.players.find(p=>p.is_me),turn=st.current_turn_seat,hand=st.state.my_hand||[],l=st.state.left,r=st.state.right,can=me?.seat===turn;
  const playerRows=st.players.map(p=>'<div class="domino-player-row '+(p.seat===turn?'active':'')+'"><span>'+esc2(p.name)+(p.is_me?' • você':'')+(st.team_mode?' • Equipe '+((Number(p.team)||0)+1):'')+'</span><b>'+Number(st.state.hand_counts?.[String(p.seat)]||0)+' peça(s)</b></div>').join('');
  const chain=(st.state.chain||[]).map(t=>dominoTileHtml(t,false)).join('');
  const handHtml=hand.map(t=>{const sides=can?domSides(t,l,r):[];return '<div style="display:grid;gap:3px"><div class="domino-tile"><span>'+t[0]+'</span><span>'+t[1]+'</span></div><div style="display:flex;gap:2px">'+(sides.includes('left')?'<button class="mini-btn" onclick="playOnlineDomino('+t[0]+','+t[1]+',\'left\')">←</button>':'')+(sides.includes('right')?'<button class="mini-btn" onclick="playOnlineDomino('+t[0]+','+t[1]+',\'right\')">→</button>':'')+'</div></div>'}).join('');
  const noMove=can&&!hand.some(t=>domFits(t,l,r));
  content().innerHTML='<div class="card domino-table"><strong>'+(st.mode==='championship'?'🏆 Campeonato':'🌐 Online')+' • Dominó</strong>'+playerRows+'<div class="domino-chain">'+(chain||'<span>Aguardando a primeira peça...</span>')+'</div><div>Monte: '+Number(st.state.stock_count||0)+'</div></div><div class="card"><strong>Sua mão</strong><div class="domino-hand">'+handHtml+'</div><div class="game-status">'+(can?'Sua vez':'Aguardando '+esc2(st.players.find(p=>p.seat===turn)?.name||'jogador'))+'</div><div class="game-actions">'+(noMove?'<button class="btn primary" onclick="onlineDominoDrawPass()">'+(Number(st.state.stock_count)>0?'Comprar':'Passar')+'</button>':'')+'<button class="btn" onclick="leaveOnlineGame()">Sair</button></div></div>';
}
window.playOnlineDomino=async function(a,b,side){const st=G.online?.state;if(!st)return;try{const data=await gameRpc('play_er_domino_tile',{p_match_id:st.match_id,p_expected_version:st.version,p_tile:[a,b],p_side:side});applyOnlineState(data)}catch(e){showAppToast('Dominó',err(e));loadOnlineGame(false)}};
window.onlineDominoDrawPass=async function(){const st=G.online?.state;if(!st)return;try{const data=await gameRpc('draw_or_pass_er_domino',{p_match_id:st.match_id,p_expected_version:st.version});applyOnlineState(data)}catch(e){showAppToast('Dominó',err(e));loadOnlineGame(false)}};
function renderOnlineFinished(st){
  stopGamePoll();const me=st.players.find(p=>p.is_me),won=st.team_mode?st.winner_team!=null&&Number(me?.team)===Number(st.winner_team):st.winner_user_id===currentUid(),draw=st.winner_user_id==null&&st.winner_team==null&&st.status==='finished',result=draw?'draw':won?'win':'loss';
  const text=st.status!=='finished'?'Partida encerrada':draw?'Empate':won?'Você venceu!':'Partida concluída';
  content().innerHTML='<div class="card game-result"><div class="big">'+(won?'🏆':draw?'🤝':'🎮')+'</div><h2>'+text+'</h2><p class="muted">'+esc2(st.result_reason||'')+'</p><div class="game-actions"><button class="btn primary" onclick="openERGame(\''+st.game_type+'\')">Voltar aos modos</button></div></div>';
}
window.leaveOnlineGame=async function(){const st=G.online?.state;if(!st)return;if(st.status==='active'&&!confirm('Deseja sair desta partida?'))return;try{const data=await gameRpc('leave_er_game_match',{p_match_id:st.match_id});applyOnlineState(data)}catch(e){showAppToast('Jogos E.R.',err(e))}};

/* CONVITES */
function ensureInvite(){
  if(el('erGameInvite'))return;const d=document.createElement('div');d.id='erGameInvite';d.className='game-invite hidden';d.innerHTML='<strong id="erGameInviteTitle">🎮 Convite</strong><p id="erGameInviteText"></p><div class="actions"><button id="erGameDecline" class="btn">Recusar</button><button id="erGameAccept" class="btn gold">Aceitar</button></div>';document.body.appendChild(d);
  el('erGameDecline').onclick=()=>respondGameInvite(false);el('erGameAccept').onclick=()=>respondGameInvite(true);
}
function showInvite(inv){ensureInvite();pendingInvite=inv||null;const box=el('erGameInvite');if(!inv){box.classList.add('hidden');return}el('erGameInviteTitle').textContent='🎮 '+gameName(inv.game_type);el('erGameInviteText').textContent=(inv.host_name||'Um Embaixador')+' convidou você para '+(inv.mode==='championship'?'uma partida de Campeonato':'uma partida online')+'.';box.classList.remove('hidden')}
async function respondGameInvite(ok){if(!pendingInvite)return;try{await gameRpc('respond_er_game_match',{p_match_id:pendingInvite.match_id,p_accept:!!ok});const id=pendingInvite.match_id;showInvite(null);if(ok){show('ergames');G.online={matchId:id};await loadOnlineGame(true)}else showAppToast('Convite recusado','A partida foi encerrada.')}catch(e){showAppToast('Jogos E.R.',err(e))}}
async function pollOverview(){
  if(!currentUid()||!navigator.onLine)return;
  try{
    const data=await gameRpc('get_my_er_game_overview',{});
    showInvite(data?.invite||null);
    const cur=data?.current;
    if(cur&&cur.status==='active'&&!G.online?.matchId){
      G.online={matchId:cur.match_id};G.type=cur.game_type;G.kind='online';
      if(currentGameScreen())await loadOnlineGame(false);
    }
  }catch(e){}
}
function initOverview(){ensureInvite();if(overviewPoll)clearInterval(overviewPoll);overviewPoll=setInterval(pollOverview,5000);setTimeout(pollOverview,1200)}

/* RANKING / STATUS */
window.renderERGameRanking=async function(gameType){
  const map={Chess:'chess',Checkers:'checkers',Domino:'domino'},db=map[gameType],label={Chess:'♟️ Xadrez',Checkers:'🔴 Dama',Domino:'🁫 Dominó'}[gameType];
  el('rankExamLabel').textContent=label;el('rankingClassificationTitle').textContent='Ranking competitivo';el('rankingCriterion').textContent='Critério: mais vitórias; desempate por vitórias em Campeonato, taxa de vitórias e partidas disputadas.';
  if(!navigator.onLine){el('leaderboardList').innerHTML='<div class="empty">Ranking indisponível sem internet.</div>';return}
  try{const rows=await gameRpc('get_er_game_leaderboard',{p_game_type:db}),me=rows.find(x=>x.player_id===currentUid());el('rankPosition').textContent=me?'#'+me.rank_pos:'—';el('rankSummary').textContent=me?(me.wins+' vitória(s) • '+me.matches+' partida(s) • '+Number(me.win_rate||0).toFixed(1)+'%'):'Você ainda não concluiu partidas competitivas.';
    el('leaderboardList').innerHTML=rows.length?rows.map(x=>'<div class="leader-row '+(x.player_id===currentUid()?'me':'')+'"><div class="rank-num">'+x.rank_pos+'</div><div class="leader-name"><strong>'+esc2(x.display_name)+(x.player_id===currentUid()?' • você':'')+'</strong><small>'+esc2(x.group_name||'')+' • '+x.matches+' partidas • '+x.draws+' empate(s)</small></div><div class="leader-points"><strong>'+x.wins+'</strong><small>vitórias • '+Number(x.win_rate||0).toFixed(1)+'%</small></div></div>').join(''):'<div class="empty">Ainda não há partidas concluídas.</div>';
    el('rankLiveStatus').textContent='Atualizado agora';
  }catch(e){el('leaderboardList').innerHTML='<div class="empty">'+esc2(err(e))+'</div>'}
};
window.renderSwordRanking=async function(){
  el('rankExamLabel').textContent='⚔️ Esgrima';el('rankingClassificationTitle').textContent='Ranking da Esgrima';el('rankingCriterion').textContent='Critério: mais desafios vencidos; desempate pela soma de pontos conquistados e taxa de vitórias.';
  try{const rows=await gameRpc('get_sword_leaderboard',{}),me=rows.find(x=>x.player_id===currentUid());el('rankPosition').textContent=me?'#'+me.rank_pos:'—';el('rankSummary').textContent=me?(me.wins+' vitória(s) • '+me.total_points+' ponto(s) • '+me.challenges+' desafio(s)'):'Você ainda não concluiu Desafios de Esgrima.';el('leaderboardList').innerHTML=rows.length?rows.map(x=>'<div class="leader-row '+(x.player_id===currentUid()?'me':'')+'"><div class="rank-num">'+x.rank_pos+'</div><div class="leader-name"><strong>'+esc2(x.display_name)+(x.player_id===currentUid()?' • você':'')+'</strong><small>'+esc2(x.group_name||'')+' • '+x.challenges+' desafio(s)</small></div><div class="leader-points"><strong>'+x.wins+'</strong><small>vitórias • '+x.total_points+' pts</small></div></div>').join(''):'<div class="empty">Ainda não há Desafios de Esgrima concluídos.</div>'}catch(e){el('leaderboardList').innerHTML='<div class="empty">'+esc2(err(e))+'</div>'}
};
window.loadERActivityStatus=async function(){if(!currentUid()||!navigator.onLine)return;try{activityStatus=await gameRpc('get_my_er_activity_status',{})}catch(e){}};
window.renderERActivityStatus=function(kind){
  const labels=[...document.querySelectorAll('.status-metric span')],best=el('statusBest'),avg=el('statusAvg'),attempts=el('statusAttempts'),acc=el('statusAccuracy');
  if(kind==='Sword'){
    const s=activityStatus.sword||{},ch=Number(s.challenges||0),w=Number(s.wins||0),rate=ch?w*100/ch:0;
    if(labels[0])labels[0].textContent='Vitórias';if(labels[1])labels[1].textContent='Pontos';if(labels[2])labels[2].textContent='Desafios';if(labels[3])labels[3].textContent='Taxa de vitórias';
    best.textContent=w;avg.textContent=Number(s.points||0);attempts.textContent=ch;acc.textContent=rate.toFixed(0)+'%';el('statusMessage').textContent='Desempenho dos Desafios de Esgrima concluídos.';
    renderActivityVisual('⚔️ Esgrima',ch,w,0,rate);return;
  }
  const db=GAME_DB_NAMES[kind],g=(activityStatus.games||[]).find(x=>x.type===db)||{},m=Number(g.competitive_matches||0),w=Number(g.competitive_wins||0),solo=Number(g.solo_matches||0),sw=Number(g.solo_wins||0),rate=m?w*100/m:0;
  if(labels[0])labels[0].textContent='Vitórias online';if(labels[1])labels[1].textContent='Treinos vencidos';if(labels[2])labels[2].textContent='Partidas online';if(labels[3])labels[3].textContent='Taxa de vitórias';
  best.textContent=w;avg.textContent=sw;attempts.textContent=m;acc.textContent=rate.toFixed(0)+'%';el('statusMessage').textContent=gameName(db)+' • '+solo+' treino(s) contra IA registrado(s).';
  renderActivityVisual(gameName(db),m,w,Number(g.competitive_draws||0),rate);
};
function renderActivityVisual(label,matches,wins,draws,rate){
  if(el('statusChartTitle'))el('statusChartTitle').textContent='Resumo competitivo';
  if(el('statusDonutTitle'))el('statusDonutTitle').textContent='Vitórias x demais resultados';
  if(el('statusMapTitle'))el('statusMapTitle').textContent='Resumo da modalidade';
  el('statusLineChart').innerHTML='<div class="game-rank-summary"><div><strong>'+matches+'</strong><span>Partidas</span></div><div><strong>'+wins+'</strong><span>Vitórias</span></div><div><strong>'+draws+'</strong><span>Empates</span></div></div>';
  el('statusRight').textContent=wins;el('statusWrong').textContent=Math.max(0,matches-wins-draws);el('statusDonutPct').textContent=rate.toFixed(0)+'%';el('statusDonut').style.background='conic-gradient(#0b5ed7 '+Math.max(0,Math.min(100,rate))+'%,#e5edf7 0)';
  el('statusExamMap').innerHTML='<div class="status-map-row"><div class="status-map-head"><b>'+esc2(label)+'</b><span>'+wins+' vitória(s) em '+matches+' partida(s)</span></div><div class="status-map-track"><i style="width:'+Math.max(0,Math.min(100,rate))+'%"></i></div></div>';
}

window.refreshERGameCandidates=function(){if(currentGameScreen()&&G.kind&&G.kind!=='solo'&&!G.online?.matchId)renderGameOppSelection()};

initOverview();
})();