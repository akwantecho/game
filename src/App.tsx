import { useEffect, useState } from "react";
import { CODE_LENGTH } from "../shared/game";
import { Game } from "./Game";
import { Entry, GuestJoin, GuestWait, HostLobby } from "./Lobby";
import { useRoomServer } from "./net";

const readInvite = () => {
  const c = new URLSearchParams(location.search).get("room");
  return c && /^[A-Z0-9]+$/i.test(c) ? c.toUpperCase().slice(0, CODE_LENGTH) : null;
};
const dropInvite = () => history.replaceState(null, "", location.pathname);

export function App() {
  const net = useRoomServer();
  const { view, send, error, clearError } = net;
  const [invite, setInvite] = useState(readInvite);
  const [joining, setJoining] = useState<string | null>(null); // the player's name, on the join screen

  useEffect(() => {
    if (invite) send({ t: "peek", code: invite });
  }, [invite, send]);

  // Once seated in a room, the invite link has done its job.
  useEffect(() => {
    if (view && invite) {
      setInvite(null);
      dropInvite();
    }
    if (view) setJoining(null);
  }, [view, invite]);

  const leave = () => {
    clearError();
    net.leave();
  };

  let screen;
  if (net.resuming) {
    screen = (
      <div className="screen" aria-busy="true">
        <div className="kicker">جارٍ الاتصال بالغرفة…</div>
      </div>
    );
  } else if (view && view.stage === "game") {
    screen = <Game view={view} deadline={net.deadline} send={send} onLeave={leave} />;
  } else if (view) {
    screen = view.you === 0 ? <HostLobby view={view} send={send} onLeave={leave} /> : <GuestWait view={view} onLeave={leave} />;
  } else if (joining !== null) {
    screen = (
      <GuestJoin
        name={joining}
        initialCode={invite ?? ""}
        host={invite ? net.peekHost : null}
        error={error && error.code !== "session_lost" ? error.message : null}
        onCode={clearError}
        onJoin={(code) => send({ t: "join", code, name: joining })}
        onBack={() => {
          clearError();
          setJoining(null);
          setInvite(null);
          dropInvite();
        }}
      />
    );
  } else {
    screen = (
      <Entry
        invite={invite}
        inviteHost={net.peekHost}
        error={error?.message ?? null}
        onCreate={(name, timeLimit) => {
          clearError();
          send({ t: "create", name, timeLimit });
        }}
        onJoin={(name) => {
          clearError();
          setJoining(name);
        }}
      />
    );
  }

  return (
    <div className="phone">
      <div className="phone-top" />
      {!net.online && !net.resuming && <div className="offline">انقطع الاتصال بالخادم… نعيد المحاولة.</div>}
      {screen}
    </div>
  );
}
