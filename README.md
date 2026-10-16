# حرب الحروف — online match

Two players, one phone each. Built from the Claude Design screen
`design/project/Online Match Mobile.dc.html` (the Broadsheet design system lives in
`src/styles/broadsheet.css`, copied unchanged).

```
npm install
npm run dev      # Vite on :5173 + room server on :8787 (Vite proxies /ws)
npm test         # rules, each match variant, and a full two-client match over real WebSockets
npm run build && npm start   # one process on $PORT (default 8787) serves app + /ws
```

To try it with two real phones on the same Wi-Fi, run `npm run dev` and open
`http://<your-computer's-LAN-IP>:5173` on both.

## How it works

- **`server/`** holds each room and runs the match: it picks the letters and
  questions, keeps the clock (with 400 ms of grace for network latency) and
  grades answers. The phones only send intents (`pick`, `answer`, …). The
  answer to an open question never leaves the server until the turn ends.
  A room never asks the same question twice, even across rematches. It also
  holds back questions whose answer has already come up on that letter. Only
  when every question for a letter has been asked does it reuse the one asked
  longest ago.
- **`shared/`** contains the board rules (answer normalisation, hex neighbours
  and the win-path search) and the message types.
- **`src/`** is the React client. Each phone renders its own view of the room.
  It reconnects on its own and gets its seat back after a reload or a dropped
  connection, using a token kept in `localStorage`.

### Flow

1. Each player types their name and the host creates a room. They get a
   5-character code and a share button that sends `…/?room=CODE`. While
   waiting, the host sets the match rules (see below). The guest sees them
   update live, and the host's phone remembers them for the next room.
2. The guest enters the code, or opens the link. A wrong code shows
   «الرمز غير صحيح…».
3. «ابدأ المباراة» is enabled once the guest is connected. The host (cyan)
   links right ↔ left and the guest (magenta) links top ↕ bottom. The host
   plays first.
4. Only the player whose turn it is can pick a cell and type. The other phone
   shows the question and the timer. Both phones see the result. The first
   unbroken path wins, and either player can start «مباراة أخرى».

### Match rules

The host picks a preset («كلاسيكي», «حروف», «فوضى») or sets each rule on its
own. `shared/game.ts` (`Rules`, `PRESETS`) defines them and `server/room.ts`
enforces them.

| Rule | Options | Effect |
| --- | --- | --- |
| Answer time | 10 / 20 / 30 s | Time to answer, and to buzz in buzzer mode |
| Board size | 4×4 / 5×5 / 6×6 | A 6×6 board repeats a few letters, none more than twice |
| Mode | بالدور / الجرس | Turns: the picker answers. Buzzer: both phones see the question, the first to buzz answers within 10 s. The picker still alternates |
| Steal | on / off | A missed question goes to the other player for half the time (at least 8 s). They can pass. A steal that runs out doesn't count as wrong |
| Special cells | on / off | Gold: whoever takes it picks next. Bomb: whoever misses it first loses a random cell. Fast: every window is halved (at least 5 s). 1, 2 or 3 of each, by board size |
| Power-ups | on / off | Skip the question, +10 s, or a hint (first letter and one blank per letter). Each player gets each one once per match. The hint is visible only to the player who asked |
| Category | on / off | After picking a letter, the picker chooses the question's category when the letter has more than one |
| Penalty | بدون / قفل / للخصم | After a miss: nothing, the cell is locked for the next turn, or the cell goes to the opponent. With «للخصم» the steal is off. A lock is lifted when the locked cell is the only one left |

### Additions beyond the mock

The prototype simulated both phones on one page. A real app needed a few extra
things:

- an entry screen (name, answer time, create or join) in place of the
  `Players Setup` hand-off;
- back and leave buttons («رجوع», «إلغاء», «مغادرة», «مغادرة الغرفة»);
- notices for "offline" and "opponent disconnected";
- an invite link.

When the host leaves, the room closes for both players. Rooms that nobody is
connected to are dropped after 15 minutes. On a large screen the app is drawn
inside the prototype's phone frame.

### Next steps

Rooms live in memory, so restarting the server ends any matches in progress.
The 42-question sample bank is in `server/questions.ts`, using the planned
table's fields. Swapping it for the database, and keeping room state in
Redis or Postgres when there is more than one server process, are the two
things left before this goes to production.

## Design files

`design/` holds the original Claude Design export: the HTML prototypes, the Broadsheet design system and the design chat transcript. They are reference material only, and the app doesn't load them.
