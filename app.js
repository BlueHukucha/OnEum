const $=id=>document.getElementById(id);
let fileURL=null,recordURL=null,ctx,stream,source,analyser,recorder,chunks=[],points=[],raf,startAt=0,lastSample=0,blob=null,active=false,paused=false,pausedAt=0,pausedTotal=0;
let canvas=$('chart'),g=canvas.getContext('2d');let mode='smooth';
function setStatus(s){$('status').textContent=s}
function noteName(m){const names=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];return names[((Math.round(m)%12)+12)%12]+(Math.floor(Math.round(m)/12)-1)}
function pitch(buffer,sampleRate){let n=buffer.length;let rms=Math.sqrt(buffer.reduce((a,v)=>a+v*v,0)/n);if(rms<0.018)return null;
let minLag=Math.floor(sampleRate/900),maxLag=Math.min(Math.floor(sampleRate/75),Math.floor(n/2));let best=0,lag=0;
// Normalized difference of overlapping samples; reject weak/ambiguous periodicity.
for(let k=minLag;k<=maxLag;k+=2){let cross=0,aa=0,bb=0;for(let i=0;i<n-k;i+=8){let a=buffer[i],b=buffer[i+k];cross+=a*b;aa+=a*a;bb+=b*b}let score=cross/Math.sqrt(aa*bb+1e-10);if(score>best){best=score;lag=k}}
if(best<.84||!lag)return null;return sampleRate/lag}
function draw(){const ratio=window.devicePixelRatio||1;let w=canvas.clientWidth,h=canvas.clientHeight;if(canvas.width!==Math.round(w*ratio)||canvas.height!==Math.round(h*ratio)){canvas.width=w*ratio;canvas.height=h*ratio}g.setTransform(ratio,0,0,ratio,0,0);g.clearRect(0,0,w,h);g.strokeStyle='#e4eee8';g.lineWidth=1;for(let i=1;i<6;i++){let y=h*i/6;g.beginPath();g.moveTo(0,y);g.lineTo(w,y);g.stroke()}if(points.length<2)return;let rendered=points.map((p,i)=>{if(mode==='raw'||p.m===null)return p;const nearby=points.slice(Math.max(0,i-2),Math.min(points.length,i+3)).filter(q=>q.m!==null).map(q=>q.m).sort((a,b)=>a-b);return {...p,m:nearby.length?nearby[Math.floor(nearby.length/2)]:null}});let valid=rendered.filter(p=>p.m!==null);if(!valid.length)return;let lo=Math.floor(valid.reduce((a,p)=>Math.min(a,p.m),Infinity)/12)*12,hi=Math.ceil(valid.reduce((a,p)=>Math.max(a,p.m),-Infinity)/12)*12;if(hi-lo<12)hi=lo+12;let total=Math.max(15,points[points.length-1].t);g.lineWidth=2.5;g.strokeStyle='#2c9572';g.lineJoin='round';g.beginPath();let started=false;for(let p of rendered){if(p.m===null){started=false;continue}let x=p.t/total*w,y=h-16-(p.m-lo)/(hi-lo)*(h-32);if(!started)g.moveTo(x,y);else g.lineTo(x,y);started=true}g.stroke();g.fillStyle='#6b857a';g.font='11px sans-serif';g.fillText(noteName(hi),8,13);g.fillText(noteName(lo),8,h-5)}
function frame(){if(!active||paused)return;let now=performance.now(),secs=(now-startAt-pausedTotal)/1000;$('elapsed').textContent=Math.floor(secs/60)+':'+String(Math.floor(secs%60)).padStart(2,'0');if(now-lastSample>85){let buf=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(buf);let rms=Math.sqrt(buf.reduce((s,v)=>s+v*v,0)/buf.length);let hz=pitch(buf,ctx.sampleRate);if(!hz&&rms>.006)$('note').textContent='분석 중';let m=hz?69+12*Math.log2(hz/440):null;points.push({t:Math.round(secs*100)/100,m:m===null?null:Math.round(m*100)/100});$('note').textContent=m===null?'—':noteName(m);$('freq').textContent=hz===null?'—':Math.round(hz)+' Hz';lastSample=now;draw()}raf=requestAnimationFrame(frame)}

let micContext=null,micStream=null,micAnalyser=null,micSource=null,micTimer=0,micTesting=false;
let mediaRecorder=null,mediaChunks=[],recordStream=null,recordContext=null,recordAnalyser=null,recordSource=null;
let recording=false,recordPaused=false,recordStarted=0,pauseStarted=0,pauseAccum=0,monitorTimer=0,recordMime='';
let songGainContext=null,songGain=null,songMediaSource=null;
function reportMic(message){$('micStatus').textContent=message}
function updatePitch(an,context,record){
 if(!an||!context)return;
 const data=new Float32Array(an.fftSize);an.getFloatTimeDomainData(data);
 let sum=0;for(let i=0;i<data.length;i++)sum+=data[i]*data[i];
 const rms=Math.sqrt(sum/data.length);
 $('micMeter').style.width=Math.min(100,Math.round(rms*500))+'%';
 let hz=pitch(data,context.sampleRate);
 let midi=hz?69+12*Math.log2(hz/440):null;
 $('note').textContent=midi===null?'—':noteName(midi);
 $('freq').textContent=hz===null?'—':Math.round(hz)+' Hz';
 if(record){let secs=(performance.now()-recordStarted-pauseAccum)/1000;secs=Math.max(0,secs);$('elapsed').textContent=Math.floor(secs/60)+':'+String(Math.floor(secs%60)).padStart(2,'0');points.push({t:Math.round(secs*100)/100,m:midi===null?null:Math.round(midi*100)/100});draw()}
 return rms;
}
async function openMicrophone(){
 if(!navigator.mediaDevices?.getUserMedia)throw Error('마이크 API를 사용할 수 없어요. HTTPS Safari에서 열어 주세요.');
 const s=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
 if(!s.getAudioTracks().length)throw Error('오디오 트랙이 없어요.');
 const c=new (window.AudioContext||window.webkitAudioContext)();
 await c.resume();const source=c.createMediaStreamSource(s);const analyser=c.createAnalyser();analyser.fftSize=4096;source.connect(analyser);
 return {s,c,source,analyser};
}
async function stopMicTest(){micTesting=false;clearInterval(micTimer);micTimer=0;if(micStream)micStream.getTracks().forEach(t=>t.stop());if(micContext)await micContext.close().catch(()=>{});micStream=null;micContext=null;micAnalyser=null;$('micMeter').style.width='0%';$('micTest').disabled=false;$('micOff').disabled=true;}
$('micTest').onclick=async()=>{
 if(micTesting)return;
 $('micTest').disabled=true;reportMic('마이크 연결 중…');
 try{const m=await openMicrophone();micStream=m.s;micContext=m.c;micAnalyser=m.analyser;micTesting=true;$('micOff').disabled=false;reportMic('마이크 연결됨 · 소리를 내보세요.');micTimer=setInterval(()=>{if(!micTesting)return;let rms=updatePitch(micAnalyser,micContext,false);reportMic(rms>.008?'입력 감지 중 · 음정이 표시되면 정상이에요.':'마이크 연결됨 · 소리를 기다리고 있어요.');},120)}catch(e){reportMic('마이크 테스트 실패: '+e.name+' · '+e.message);$('micTest').disabled=false;await stopMicTest()}
};
$('micOff').onclick=async()=>{await stopMicTest();reportMic('마이크 테스트가 종료됐어요.')};
$('song').addEventListener('change',e=>{const f=e.target.files?.[0];if(!f)return;if(fileURL)URL.revokeObjectURL(fileURL);fileURL=URL.createObjectURL(f);$('player').src=fileURL;$('fileName').textContent=f.name;$('player').load();setStatus('음원이 준비됐어요. 이어폰을 착용하고 시작하세요.')});
function setVolume(){let value=Number($('songVolume').value)/100;$('volumeText').textContent=Math.round(value*100)+'%';$('player').volume=value;if(songGain)songGain.gain.value=value;}
$('songVolume').oninput=setVolume;setVolume();
async function setupGain(){
 // iOS Safari may ignore HTMLMediaElement.volume; a Web Audio gain node handles it.
 if(songGain)return;
 try{songGainContext=new (window.AudioContext||window.webkitAudioContext)();songMediaSource=songGainContext.createMediaElementSource($('player'));songGain=songGainContext.createGain();songMediaSource.connect(songGain);songGain.connect(songGainContext.destination);await songGainContext.resume();setVolume()}
 catch(e){console.warn('Audio gain unavailable',e);setStatus('볼륨 조절 지원이 제한될 수 있어요: '+e.message)}
}
function resetRecordControls(){recording=false;recordPaused=false;$('start').textContent='● 녹음 시작';$('stop').disabled=true;$('start').disabled=false;}
async function releaseRecord(){clearInterval(monitorTimer);monitorTimer=0;if(recordStream)recordStream.getTracks().forEach(t=>t.stop());if(recordContext)await recordContext.close().catch(()=>{});recordStream=null;recordContext=null;recordAnalyser=null;}
async function startRecording(){
 $('start').disabled=true;setStatus('마이크 연결 및 녹음 준비 중…');
 try{
  await stopMicTest();const m=await openMicrophone();recordStream=m.s;recordContext=m.c;recordAnalyser=m.analyser;
  if(typeof MediaRecorder==='undefined')throw Error('이 브라우저에서 MediaRecorder를 사용할 수 없어요.');
  recordMime=['audio/mp4','audio/webm;codecs=opus','audio/webm'].find(x=>MediaRecorder.isTypeSupported(x))||'';
  mediaRecorder=new MediaRecorder(recordStream,recordMime?{mimeType:recordMime}:undefined);
  mediaChunks=[];points=[];blob=null;$('saveAudio').disabled=true;$('saveData').disabled=true;$('next1').disabled=true;
  mediaRecorder.ondataavailable=e=>{if(e.data&&e.data.size>0)mediaChunks.push(e.data)};
  mediaRecorder.onerror=e=>setStatus('녹음 오류: '+(e.error?.message||'알 수 없는 오류'));
  mediaRecorder.onstop=()=>{let mime=mediaRecorder.mimeType||recordMime||'audio/mp4';blob=new Blob(mediaChunks,{type:mime});if(!blob.size){setStatus('녹음 데이터가 비어 있어요. 마이크 권한과 Safari 상태를 확인해 주세요.');return}if(recordURL)URL.revokeObjectURL(recordURL);recordURL=URL.createObjectURL(blob);$('recording').src=recordURL;$('saveAudio').disabled=false;$('saveData').disabled=false;$('next1').disabled=false;setStatus('녹음 완료 · 결과를 확인해 보세요.');showStep(2)};
  mediaRecorder.start(1000);recording=true;recordPaused=false;pauseAccum=0;recordStarted=performance.now();$('start').textContent='Ⅱ 일시정지';$('start').disabled=false;$('stop').disabled=false;
  monitorTimer=setInterval(()=>{if(recording&&!recordPaused)updatePitch(recordAnalyser,recordContext,true)},120);
  try{await setupGain();$('player').currentTime=0;await $('player').play();setStatus('녹음 중 · 마이크 입력을 확인해 주세요.')}catch(e){setStatus('녹음 중 · 원곡 자동재생 실패. 원곡 재생 버튼을 눌러 주세요. ('+e.message+')')}
 }catch(e){setStatus('녹음 시작 실패: '+e.name+' · '+e.message);resetRecordControls();await releaseRecord()}
}
async function pauseResume(){
 try{if(!recordPaused){mediaRecorder.pause();$('player').pause();recordPaused=true;pauseStarted=performance.now();$('start').textContent='▶ 이어 녹음';setStatus('일시정지됨')}else{mediaRecorder.resume();pauseAccum+=performance.now()-pauseStarted;recordPaused=false;$('start').textContent='Ⅱ 일시정지';setStatus('이어 녹음 중');try{await songGainContext?.resume();await $('player').play()}catch(e){setStatus('녹음 재개됨 · 원곡 재생은 직접 눌러 주세요.')}}}catch(e){setStatus('일시정지 오류: '+e.message)}
}
$('start').onclick=()=>recording?pauseResume():startRecording();
$('stop').onclick=async()=>{if(!recording)return;recording=false;$('player').pause();if(mediaRecorder&&mediaRecorder.state!=='inactive'){try{mediaRecorder.requestData()}catch(e){}mediaRecorder.stop()}resetRecordControls();await releaseRecord();draw()};
function download(data,name){let a=document.createElement('a'),url=URL.createObjectURL(data);a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
$('saveAudio').onclick=()=>{if(blob)download(blob,((($('song').files?.[0]?.name||'vocal-practice').replace(/\.[^.]+$/,'')).replace(/[^a-zA-Z0-9가-힣_-]/g,'_'))+'_'+new Date().toISOString().slice(0,10)+'.'+(blob.type.includes('mp4')?'m4a':'webm'))};
$('saveData').onclick=()=>download(new Blob([JSON.stringify({format:'on-eum-pitch-v1',song:$('song').files?.[0]?.name||null,createdAt:new Date().toISOString(),samples:points},null,2)],{type:'application/json'}),'pitch-data.json');
window.addEventListener('resize',draw);draw();if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});

let currentStep=0;
function showStep(i){currentStep=i;document.querySelectorAll('.step').forEach((e,j)=>e.classList.toggle('active',j===i));document.querySelectorAll('.steps div').forEach((e,j)=>e.classList.toggle('active',j<=i));$('stepLabel').textContent='STEP 0'+(i+1)+' / 03';window.scrollTo(0,0);canvas=$(i===2?'resultChart':'chart');g=canvas.getContext('2d');requestAnimationFrame(draw)}
$('next0').onclick=()=>{if(!$('song').files?.length){alert('먼저 음원을 선택해 주세요.');return}showStep(1)};
$('back1').onclick=()=>{if(!recording){stopMicTest();showStep(0)}};
$('next1').onclick=()=>{if(!recording)showStep(2)};
$('back2').onclick=()=>showStep(1);
$('again').onclick=()=>{if(!recording)showStep(1)};
$('smooth').onclick=()=>{mode='smooth';$('smooth').classList.add('selected');$('raw').classList.remove('selected');draw()};
$('raw').onclick=()=>{mode='raw';$('raw').classList.add('selected');$('smooth').classList.remove('selected');draw()};
