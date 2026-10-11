import React, { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  Camera, CameraOff, CircleStop, Clipboard, Download, FlipHorizontal, Link2,
  Monitor, Power, Radio, RefreshCw, ShieldCheck, Smartphone, Video, Wifi, X
} from "lucide-react";

const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL || window.location.origin;
const TURN_URL = import.meta.env.VITE_TURN_URL;
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  ...(TURN_URL ? [{
    urls: TURN_URL,
    username: import.meta.env.VITE_TURN_USERNAME,
    credential: import.meta.env.VITE_TURN_CREDENTIAL
  }] : [])
];

function makeSocket() {
  return io(SIGNALING_URL, { transports: ["websocket", "polling"], reconnection: true });
}
function StatusPill({ children, good = false }) {
  return <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${good ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-slate-700 bg-slate-800/70 text-slate-300"}`}><span className={`h-1.5 w-1.5 rounded-full ${good ? "bg-emerald-400" : "bg-slate-500"}`} />{children}</span>;
}
function Panel({ title, icon: Icon, children, className = "" }) {
  return <section className={`panel rounded-2xl p-5 ${className}`}><h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-200"><Icon size={17} className="text-indigo-300" />{title}</h2>{children}</section>;
}

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const isPhoneRoute = params.get("mode") === "phone";
  return isPhoneRoute ? <PhonePage /> : <Dashboard />;
}

function Dashboard() {
  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const videoRef = useRef(null);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("Connecting to signaling server…");
  const [connected, setConnected] = useState(false);
  const [requestPending, setRequestPending] = useState(false);
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const [cameraStatus, setCameraStatus] = useState("Waiting for phone");
  const [copied, setCopied] = useState(false);
  const [stats, setStats] = useState("WebRTC not connected");

  const teardownPeer = useCallback(() => {
    if (pcRef.current) { pcRef.current.ontrack = null; pcRef.current.close(); pcRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
    setConnected(false); setRecording(false); setStats("WebRTC not connected");
  }, []);

  const createPeer = useCallback(() => {
    teardownPeer();
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;
    pc.ontrack = event => {
      if (videoRef.current) videoRef.current.srcObject = event.streams[0];
      setCameraStatus("Live camera feed");
    };
    pc.onicecandidate = event => {
      if (event.candidate) socketRef.current?.emit("webrtc:ice", { candidate: event.candidate });
    };
    pc.onconnectionstatechange = () => {
      setStats(`WebRTC: ${pc.connectionState}`);
      if (pc.connectionState === "connected") setConnected(true);
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) setConnected(false);
    };
    pc.oniceconnectionstatechange = () => setStats(`ICE: ${pc.iceConnectionState}`);
    return pc;
  }, [teardownPeer]);

  useEffect(() => {
    const socket = makeSocket(); socketRef.current = socket;
    socket.on("connect", () => setStatus("Signaling server connected"));
    socket.on("disconnect", () => { setStatus("Signaling server disconnected"); teardownPeer(); });
    socket.on("connect_error", () => setStatus("Cannot reach signaling server"));
    socket.on("phone:request", () => setRequestPending(true));
    socket.on("pair:connected", async () => {
      setRequestPending(false); setError("");
      try {
        const pc = createPeer();
        const offer = await pc.createOffer({ offerToReceiveVideo: true });
        await pc.setLocalDescription(offer);
        socket.emit("webrtc:offer", { description: pc.localDescription });
      } catch (e) { setError(`Could not start video connection: ${e.message}`); }
    });
    socket.on("webrtc:answer", async ({ description }) => {
      try { if (pcRef.current && description) await pcRef.current.setRemoteDescription(description); }
      catch (e) { setError(`WebRTC answer error: ${e.message}`); }
    });
    socket.on("webrtc:ice", async ({ candidate }) => {
      try { if (pcRef.current && candidate) await pcRef.current.addIceCandidate(candidate); } catch {}
    });
    socket.on("camera:status", ({ message }) => setCameraStatus(message || "Phone camera status updated"));
    socket.on("recording:status", ({ recording: active, message }) => { setRecording(Boolean(active)); if (message) setCameraStatus(message); });
    socket.on("camera:photo", ({ dataUrl }) => {
      if (!dataUrl) return;
      const a = document.createElement("a"); a.href = dataUrl; a.download = `phone-camera-${Date.now()}.jpg`; a.click();
    });
    socket.on("phone:disconnected", () => { teardownPeer(); setCameraStatus("Phone disconnected"); setError("Phone disconnected."); });
    socket.on("pair:rejected", () => setError("Phone pairing request was rejected."));
    socket.on("session:ended", ({ reason }) => { teardownPeer(); setError(reason || "Session ended."); });
    return () => { socket.emit("room:leave"); socket.disconnect(); teardownPeer(); };
  }, [createPeer, teardownPeer]);

  const newRoom = () => {
    setError(""); setRequestPending(false); teardownPeer();
    socketRef.current?.emit("room:leave");
    socketRef.current?.emit("room:create", {}, result => {
      if (!result?.ok) return setError("Could not create a pairing code.");
      setCode(result.code);
    });
  };
  const approve = () => socketRef.current?.emit("phone:approve", {}, result => {
    if (!result?.ok) setError(result?.error || "Approval failed.");
    else { setRequestPending(false); setCameraStatus("Negotiating video connection…"); }
  });
  const reject = () => socketRef.current?.emit("phone:reject", {}, () => setRequestPending(false));
  const sendCommand = command => socketRef.current?.emit("camera:command", command);
  const phoneUrl = `${window.location.origin}${window.location.pathname}?mode=phone`;
  const copy = async text => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { setError("Clipboard access was blocked. Copy the link manually."); }
  };

  return <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#1b2450_0%,_#090d18_48%)]">
    <header className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-6 lg:px-8">
      <div className="flex items-center gap-3"><div className="rounded-xl bg-indigo-500/15 p-2.5 text-indigo-300"><Camera size={23}/></div><div><div className="font-bold tracking-tight">CAMERA<span className="text-indigo-300">LINK</span></div><div className="text-xs text-slate-400">Phone Camera Control Center</div></div></div>
      <StatusPill good={status === "Signaling server connected"}>{status}</StatusPill>
    </header>
    <main className="mx-auto grid max-w-7xl gap-5 px-5 pb-12 lg:grid-cols-[1.6fr_1fr] lg:px-8">
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.22em] text-indigo-300">Remote studio</p><h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Your phone. Your camera.</h1><p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">Pair an Android phone over the internet and view its camera feed here.</p></div><StatusPill good={connected}>{connected ? "Stream connected" : "Stream offline"}</StatusPill></div>
        <div className="panel overflow-hidden rounded-3xl">
          <div className="flex items-center justify-between border-b border-slate-700/60 px-4 py-3"><div className="flex items-center gap-2 text-sm font-medium"><span className={`h-2 w-2 rounded-full ${connected ? "animate-pulse bg-red-400" : "bg-slate-600"}`}/>{connected ? "LIVE PREVIEW" : "CAMERA PREVIEW"}</div><span className="text-xs text-slate-500">{stats}</span></div>
          <div className="relative flex aspect-video items-center justify-center bg-[#050810]">
            <video ref={videoRef} autoPlay playsInline muted className={`h-full w-full object-contain ${connected ? "" : "hidden"}`}/>
            {!connected && <div className="flex flex-col items-center px-6 text-center"><div className="mb-4 rounded-2xl border border-slate-700 bg-slate-900 p-5 text-slate-500"><CameraOff size={34}/></div><p className="font-semibold text-slate-300">No live feed yet</p><p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">Create a pairing code, open the phone link on Android, then approve its request.</p></div>}
            {connected && <span className="absolute left-4 top-4 rounded-md bg-red-500/90 px-2 py-1 text-[10px] font-bold tracking-widest text-white">LIVE</span>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-700/60 px-4 py-3"><span className="text-xs text-slate-400">{cameraStatus}</span><div className="flex gap-2"><button className="btn btn-secondary text-sm" disabled={!connected} onClick={() => sendCommand({ type: "switch-camera" })}><FlipHorizontal size={16}/> Flip</button><button className="btn btn-secondary text-sm" disabled={!connected} onClick={() => sendCommand({ type: "capture" })}><Camera size={16}/> Capture</button></div></div>
        </div>
        <Panel title="Remote controls" icon={Radio}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <button className="btn btn-secondary" disabled={!connected || recording} onClick={() => sendCommand({ type: "record-start" })}><Video size={17}/> Start recording</button>
            <button className="btn btn-secondary" disabled={!connected || !recording} onClick={() => sendCommand({ type: "record-stop" })}><CircleStop size={17}/> Stop recording</button>
            <button className="btn btn-secondary" disabled={!connected} onClick={() => sendCommand({ type: "torch-toggle" })}><Power size={17}/> Toggle torch</button>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-500">Recording is created on the Android phone and downloaded there. Torch control works only if supported by the browser and device.</p>
        </Panel>
      </div>
      <aside className="space-y-5">
        <Panel title="Secure device pairing" icon={ShieldCheck}>
          <p className="text-sm leading-6 text-slate-400">Use a short-lived code. The phone must request access, and you must approve it before video signaling starts.</p>
          <button className="btn btn-primary mt-4 w-full" onClick={newRoom}><RefreshCw size={17}/> Generate pairing code</button>
          {code && <div className="mt-4 rounded-2xl border border-indigo-400/25 bg-indigo-500/10 p-4 text-center"><p className="text-xs uppercase tracking-[.18em] text-indigo-200">Pairing code · expires in 30 min</p><div className="my-2 font-mono text-4xl font-bold tracking-[.25em] text-white">{code}</div><button className="btn btn-secondary mt-1" onClick={() => copy(code)}><Clipboard size={15}/>{copied ? "Copied" : "Copy code"}</button></div>}
          {requestPending && <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-500/10 p-4"><p className="font-semibold text-amber-200">Android phone wants to connect</p><p className="mt-1 text-xs leading-5 text-slate-400">Only approve if this is your phone and you initiated the pairing.</p><div className="mt-3 flex gap-2"><button className="btn btn-primary flex-1" onClick={approve}>Approve</button><button className="btn btn-secondary flex-1" onClick={reject}>Reject</button></div></div>}
          {error && <div className="mt-4 flex gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200"><X size={17} className="mt-0.5 shrink-0"/><span>{error}</span></div>}
        </Panel>
        <Panel title="Connect your Android" icon={Smartphone}>
          <ol className="space-y-3 text-sm text-slate-300">
            <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-indigo-300">1</span><span>Deploy this app to an HTTPS website and open the dashboard.</span></li>
            <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-indigo-300">2</span><span>Open the same website on Android Chrome with <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">?mode=phone</code> at the end.</span></li>
            <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-indigo-300">3</span><span>Enter the code, allow camera permission, and approve the request here.</span></li>
          </ol>
          <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900/70 p-3"><p className="mb-2 text-xs font-semibold text-slate-400">PHONE LINK</p><p className="break-all text-xs text-indigo-200">{phoneUrl}</p><button className="btn btn-secondary mt-3 w-full text-sm" onClick={() => copy(phoneUrl)}><Link2 size={16}/> Copy phone link</button></div>
        </Panel>
        <Panel title="Connection health" icon={Wifi}>
          <div className="space-y-3 text-sm"><div className="flex items-center justify-between"><span className="text-slate-400">Signaling</span><span className={status === "Signaling server connected" ? "text-emerald-300" : "text-amber-300"}>{status.includes("connected") ? "Connected" : "Offline"}</span></div><div className="flex items-center justify-between"><span className="text-slate-400">WebRTC</span><span className={connected ? "text-emerald-300" : "text-slate-400"}>{connected ? "Connected" : "Waiting"}</span></div><div className="flex items-center justify-between"><span className="text-slate-400">Video recording</span><span className={recording ? "text-red-300" : "text-slate-400"}>{recording ? "Recording" : "Idle"}</span></div></div>
          <p className="mt-4 border-t border-slate-700/60 pt-3 text-xs leading-5 text-slate-500">Remote networks may require a TURN relay. For production, configure TURN credentials and use HTTPS/WSS.</p>
        </Panel>
      </aside>
    </main>
    <footer className="border-t border-slate-800 px-5 py-5 text-center text-xs text-slate-600">Camera access is permission-based. Use only on devices you own or have explicit permission to operate.</footer>
  </div>;
}

function PhonePage() {
  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const facingRef = useRef("environment");
  const torchRef = useRef(false);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("Enter the pairing code shown on your dashboard.");
  const [joined, setJoined] = useState(false);
  const [approved, setApproved] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");

  const stopCamera = useCallback(() => {
    if (recorderRef.current?.state && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }, []);

  const stopPeer = useCallback(() => {
    pcRef.current?.close(); pcRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera API unavailable. Open this page over HTTPS in Chrome.");
      streamRef.current?.getTracks().forEach(t => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: facingRef.current }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } }
      });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
      setCameraReady(true);
      return stream;
    } catch (e) {
      setError(e.name === "NotAllowedError" ? "Camera permission denied. Allow camera access in Chrome site settings." : e.message);
      setStatus("Camera unavailable");
      throw e;
    }
  }, []);

  const makePeer = useCallback(async () => {
    stopPeer();
    const stream = streamRef.current || await startCamera();
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    pc.onicecandidate = event => { if (event.candidate) socketRef.current?.emit("webrtc:ice", { candidate: event.candidate }); };
    pc.onconnectionstatechange = () => setStatus(`Video connection: ${pc.connectionState}`);
    pc.onnegotiationneeded = () => {};
    return pc;
  }, [startCamera, stopPeer]);

  useEffect(() => {
    const socket = makeSocket(); socketRef.current = socket;
    socket.on("connect", () => setStatus("Connected to server. Enter your pairing code."));
    socket.on("disconnect", () => setStatus("Signaling server disconnected."));
    socket.on("pair:approved", async () => {
      setApproved(true); setError(""); setStatus("Approved. Starting camera…");
      try { await startCamera(); setStatus("Camera ready. Connecting video…"); }
      catch { setApproved(false); }
    });
    socket.on("pair:rejected", () => { setApproved(false); setJoined(false); setStatus("Pairing request rejected."); });
    socket.on("webrtc:offer", async ({ description }) => {
      try {
        const pc = await makePeer();
        await pc.setRemoteDescription(description);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("webrtc:answer", { description: pc.localDescription });
        setStatus("Sending live video to dashboard.");
      } catch (e) { setError(`Could not establish video: ${e.message}`); }
    });
    socket.on("webrtc:ice", async ({ candidate }) => {
      try { if (pcRef.current && candidate) await pcRef.current.addIceCandidate(candidate); } catch {}
    });
    socket.on("camera:command", async command => {
      try {
        if (command.type === "capture") capturePhoto();
        if (command.type === "switch-camera") await switchCamera();
        if (command.type === "record-start") startRecording();
        if (command.type === "record-stop") stopRecording();
        if (command.type === "torch-toggle") await toggleTorch();
      } catch (e) { setError(e.message || "Camera command failed."); }
    });
    socket.on("session:ended", ({ reason }) => {
      stopPeer(); stopCamera(); setApproved(false); setJoined(false); setStatus(reason || "Session ended.");
    });
    return () => { socket.emit("room:leave"); socket.disconnect(); stopPeer(); stopCamera(); };
  }, [makePeer, startCamera, stopCamera, stopPeer]);

  const joinRoom = () => {
    setError("");
    const normalized = code.replace(/\D/g, "").slice(0, 6);
    if (normalized.length !== 6) return setError("Enter the 6-digit pairing code.");
    socketRef.current?.emit("room:join", { code: normalized }, result => {
      if (!result?.ok) return setError(result?.error || "Could not join.");
      setJoined(true); setStatus("Request sent. Approve the phone on your dashboard.");
    });
  };
  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return setError("Camera is not ready yet.");
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.94);
    socketRef.current?.emit("camera:photo", { dataUrl });
    setStatus("Photo captured and sent to dashboard.");
  };


const switchCamera = async () => {
  const oldStream = streamRef.current;
  const pc = pcRef.current;
  const sender = pc?.getSenders().find(
    item => item.track?.kind === "video"
  );

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter(
      device => device.kind === "videoinput"
    );

    if (cameras.length < 2) {
      throw new Error("Second camera not found on this device.");
    }

    const currentTrack = oldStream?.getVideoTracks()[0];
    const currentId = currentTrack?.getSettings().deviceId;
    const currentIndex = cameras.findIndex(
      camera => camera.deviceId === currentId
    );

    const nextCamera =
      cameras[(currentIndex + 1 + cameras.length) % cameras.length];

    const nextStream =
      await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: { exact: nextCamera.deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });

    const nextTrack = nextStream.getVideoTracks()[0];

    if (sender) {
      await sender.replaceTrack(nextTrack);
    }

    streamRef.current = nextStream;

    if (videoRef.current) {
      videoRef.current.srcObject = nextStream;
      await videoRef.current.play();
    }

    oldStream?.getTracks().forEach(track => track.stop());

    facingRef.current =
      nextTrack.getSettings().facingMode || "environment";

    setError("");
    setCameraReady(true);
    setStatus("Camera switched successfully.");
  } catch (error) {
    setError(`Could not switch camera: ${error.message}`);
  }
};

  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream) return setError("Camera is not ready.");
    if (!window.MediaRecorder) return setError("Video recording is not supported by this browser.");
    const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(t => MediaRecorder.isTypeSupported(t));
    try {
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      recorder.ondataavailable = e => { if (e.data?.size) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "video/webm" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = `phone-recording-${Date.now()}.webm`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        setRecording(false);
        socketRef.current?.emit("recording:status", { recording: false, message: "Recording saved to phone downloads." });
      };
      recorder.start(1000); setRecording(true);
      socketRef.current?.emit("recording:status", { recording: true, message: "Video recording in progress on phone." });
    } catch (e) { setError(`Recording failed: ${e.message}`); }
  };
  const stopRecording = () => {
    if (recorderRef.current?.state && recorderRef.current.state !== "inactive") recorderRef.current.stop();
  };
  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) throw new Error("Camera is not ready.");
    const capabilities = track.getCapabilities?.();
    if (!capabilities?.torch) throw new Error("Torch is not supported by this device/browser.");
    torchRef.current = !torchRef.current;
    await track.applyConstraints({ advanced: [{ torch: torchRef.current }] });
    setStatus(torchRef.current ? "Torch is on." : "Torch is off.");
  };
  const disconnect = () => {
    socketRef.current?.emit("room:leave");
    stopPeer(); stopCamera(); setJoined(false); setApproved(false); setStatus("Disconnected.");
  };

  return <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#1b2450_0%,_#090d18_48%)] px-4 py-8">
    <main className="mx-auto max-w-xl space-y-5">
      <header className="flex items-center gap-3"><div className="rounded-xl bg-indigo-500/15 p-3 text-indigo-300"><Smartphone size={24}/></div><div><h1 className="text-xl font-bold">CameraLink Phone</h1><p className="text-xs text-slate-400">Android camera companion</p></div></header>
      <div className="panel rounded-2xl p-5"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Pair to dashboard</h2><StatusPill good={approved}>{approved ? "Approved" : joined ? "Awaiting approval" : "Not paired"}</StatusPill></div>
        {!joined && <><label className="mt-4 block text-xs text-slate-400" htmlFor="pair-code">6-digit pairing code</label><input id="pair-code" className="field mt-2 text-center font-mono text-2xl tracking-[.3em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}/><button className="btn btn-primary mt-3 w-full" onClick={joinRoom}><Link2 size={17}/> Request connection</button></>}
        <p className="mt-3 text-sm text-slate-400">{status}</p>
        {error && <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
      </div>
      <div className="panel overflow-hidden rounded-2xl"><div className="flex items-center justify-between border-b border-slate-700/60 px-4 py-3"><span className="text-sm font-semibold">Local camera preview</span><span className="text-xs text-slate-400">{cameraReady ? "Camera active" : "Camera off"}</span></div><div className="aspect-[4/3] bg-black"><video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-contain"/></div>
        <div className="grid grid-cols-2 gap-3 p-4"><button className="btn btn-secondary" disabled={!cameraReady} onClick={capturePhoto}><Camera size={16}/> Capture photo</button><button className="btn btn-secondary" disabled={!cameraReady || recording} onClick={startRecording}><Video size={16}/> Record</button><button className="btn btn-secondary" disabled={!recording} onClick={stopRecording}><CircleStop size={16}/> Stop & save</button><button className="btn btn-danger" onClick={disconnect}><Power size={16}/> Disconnect</button></div>
      </div>
      <div className="rounded-xl border border-slate-700/70 bg-slate-900/60 p-4 text-xs leading-5 text-slate-400"><p className="mb-1 flex items-center gap-2 font-semibold text-slate-300"><ShieldCheck size={15}/> Privacy</p>Camera starts only after dashboard approval and browser permission. Keep this page open while streaming or recording. Disconnect to stop camera access. Recordings are saved locally through the browser download flow.</div>
    </main>
  </div>;
}