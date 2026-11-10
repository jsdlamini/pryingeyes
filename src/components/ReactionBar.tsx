"use client";
import { useMemo, useState } from "react";
import { api } from "./api";

type Group = { name: string; emojis: [string, string][] };

const GROUPS: Group[] = [
  { name: "Smileys", emojis: [
    ["😀", "grin happy smile face"], ["😃", "smiley happy"], ["😄", "smile open"], ["😁", "grin teeth"], ["😆", "laugh xd"], ["😅", "sweat smile"], ["😂", "tears joy laugh lol"], ["🤣", "rofl rolling laugh"], ["😊", "blush smile"], ["😇", "angel halo"], ["🙂", "smile slight"], ["😉", "wink"], ["😌", "relieved"], ["😍", "heart eyes love"], ["🥰", "love hearts"], ["😘", "kiss blow"], ["😋", "yum tasty"], ["😎", "cool sunglasses"], ["🤩", "star eyes wow"], ["🥳", "party birthday"], ["😏", "smirk"], ["😒", "unamused"], ["😞", "sad disappointed"], ["😔", "sad pensive"], ["😢", "cry tear"], ["😭", "crying sob"], ["😤", "angry steam"], ["😠", "angry mad"], ["🤬", "cursing swear"], ["😱", "scream scared"], ["😨", "fear scared"], ["😳", "flushed embarrassed"], ["🥺", "pleading puppy"], ["🤔", "thinking hmm"], ["🙄", "roll eyes"], ["😴", "sleep tired"], ["🤗", "hug"], ["🤭", "giggle hand"], ["🥴", "woozy drunk"], ["🤯", "mind blown"], ["😮", "wow surprised"], ["😲", "astonished shocked"], ["😬", "grimace awkward"], ["😪", "sleepy"], ["🥱", "yawn tired"], ["🤐", "zipper secret"], ["🤒", "sick fever"], ["🤕", "hurt injury"], ["🤢", "nauseated sick"], ["🤧", "sneeze"], ["🥶", "cold freeze"], ["🥵", "hot heat"], ["😷", "mask sick"], ["🤠", "cowboy"],
  ]},
  { name: "Gestures", emojis: [
    ["👍", "thumbs up like yes ok"], ["👎", "thumbs down no"], ["👌", "ok perfect"], ["✌️", "peace victory"], ["🤞", "fingers crossed"], ["🤟", "love you"], ["🤘", "rock horns"], ["🤙", "call me shaka"], ["👏", "clap applause"], ["🙌", "hooray celebrate"], ["👐", "open hands"], ["🤝", "handshake deal"], ["🙏", "pray thanks please"], ["💪", "muscle strong"], ["✊", "fist power"], ["👊", "punch fist bump"], ["🖖", "vulcan spock"], ["👋", "wave hi bye"], ["🤚", "hand stop"], ["☝️", "point up"], ["👇", "point down"], ["👆", "point up"], ["👉", "point right"], ["👈", "point left"], ["✋", "hand raise stop"], ["🤏", "pinch small"], ["✍️", "writing sign"], ["💅", "nail polish"], ["🤳", "selfie"], ["💃", "dance woman"], ["🕺", "dance man"],
  ]},
  { name: "Hearts", emojis: [
    ["❤️", "heart love red"], ["🧡", "orange heart"], ["💛", "yellow heart"], ["💚", "green heart"], ["💙", "blue heart"], ["💜", "purple heart"], ["🖤", "black heart"], ["🤍", "white heart"], ["🤎", "brown heart"], ["💔", "broken heart"], ["💕", "two hearts"], ["💞", "revolving hearts"], ["💓", "beating heart"], ["💗", "growing heart"], ["💖", "sparkling heart"], ["💘", "arrow heart"], ["💝", "gift heart"], ["❣️", "heart exclamation"], ["💌", "love letter"], ["💟", "heart decoration"],
  ]},
  { name: "Fun", emojis: [
    ["🎉", "party celebrate confetti"], ["🔥", "fire hot lit"], ["💯", "100 hundred perfect"], ["⭐", "star"], ["✨", "sparkle shiny"], ["⚡", "bolt lightning"], ["🌟", "glowing star"], ["💫", "dizzy star"], ["🎂", "cake birthday"], ["🎁", "gift present"], ["🏆", "trophy winner"], ["🥇", "gold medal first"], ["👀", "eyes look"], ["💋", "kiss lips"], ["☕", "coffee tea"], ["🍀", "clover luck"], ["🌈", "rainbow"], ["🙈", "monkey hide"], ["🙉", "monkey hear"], ["🙊", "monkey speak"], ["💀", "skull dead"], ["🤡", "clown"], ["👻", "ghost"], ["👽", "alien"], ["🤖", "robot"], ["🎃", "pumpkin halloween"], ["🎄", "christmas tree"], ["🎅", "santa"], ["💩", "poop"], ["😹", "cat laugh"],
  ]},
  { name: "Sports", emojis: [
    ["⚽", "soccer football ball"], ["🏀", "basketball"], ["🏈", "american football"], ["⚾", "baseball"], ["🎾", "tennis"], ["🏐", "volleyball"], ["🎱", "billiards pool 8ball"], ["🏓", "ping pong table tennis"], ["🏸", "badminton"], ["🥊", "boxing glove"], ["🥋", "martial arts karate"], ["⛳", "golf flag hole"], ["🏹", "archery bow arrow"], ["🎣", "fishing"], ["🎿", "skiing"], ["⛸️", "ice skate"], ["🏂", "snowboard"], ["🏋️", "weightlifting gym"], ["🤸", "gymnastics"], ["🏊", "swimming"], ["🚴", "cycling bike"], ["🚵", "mountain biking"], ["🧘", "yoga meditation"], ["🏄", "surfing"], ["🏆", "trophy"], ["🥇", "gold"], ["🥈", "silver"], ["🥉", "bronze"], ["🏅", "medal"], ["🎮", "video game controller"], ["🎯", "dart target bullseye"], ["🎲", "dice game"], ["🎳", "bowling"],
  ]},
  { name: "Food & Drink", emojis: [
    ["🍏", "green apple"], ["🍎", "red apple"], ["🍊", "orange tangerine"], ["🍋", "lemon"], ["🍌", "banana"], ["🍉", "watermelon"], ["🍇", "grapes"], ["🍓", "strawberry"], ["🍒", "cherries"], ["🍑", "peach"], ["🍍", "pineapple"], ["🥥", "coconut"], ["🥝", "kiwi"], ["🍅", "tomato"], ["🥑", "avocado"], ["🍆", "eggplant"], ["🥔", "potato"], ["🥕", "carrot"], ["🌽", "corn"], ["🌶️", "chili pepper hot"], ["🥦", "broccoli"], ["🍄", "mushroom"], ["🥜", "peanuts"], ["🍞", "bread"], ["🥐", "croissant"], ["🧀", "cheese"], ["🍖", "meat"], ["🍗", "chicken poultry"], ["🥩", "steak beef"], ["🍔", "burger hamburger"], ["🍟", "fries chips"], ["🍕", "pizza"], ["🌭", "hotdog"], ["🥪", "sandwich"], ["🌮", "taco"], ["🌯", "burrito"], ["🍝", "spaghetti pasta"], ["🍜", "noodles ramen"], ["🍣", "sushi"], ["🍤", "shrimp prawn"], ["🍚", "rice"], ["🍦", "ice cream"], ["🍩", "doughnut donut"], ["🍪", "cookie"], ["🎂", "cake"], ["🍰", "cake slice"], ["🍫", "chocolate"], ["🍬", "candy"], ["🍿", "popcorn"], ["🥤", "soda drink"], ["🍺", "beer"], ["🍷", "wine"], ["🍸", "cocktail"], ["🍹", "drink"],
  ]},
  { name: "Animals & Nature", emojis: [
    ["🐶", "dog puppy"], ["🐱", "cat kitten"], ["🐭", "mouse"], ["🐹", "hamster"], ["🐰", "rabbit bunny"], ["🦊", "fox"], ["🐻", "bear"], ["🐼", "panda"], ["🐨", "koala"], ["🐯", "tiger"], ["🦁", "lion"], ["🐮", "cow"], ["🐷", "pig"], ["🐸", "frog"], ["🐔", "chicken"], ["🐧", "penguin"], ["🐦", "bird"], ["🦅", "eagle"], ["🦉", "owl"], ["🦇", "bat"], ["🐺", "wolf"], ["🐴", "horse"], ["🦄", "unicorn"], ["🐝", "bee"], ["🦋", "butterfly"], ["🐞", "ladybug beetle"], ["🕷️", "spider"], ["🐢", "turtle tortoise"], ["🐍", "snake"], ["🐙", "octopus"], ["🦑", "squid"], ["🦀", "crab"], ["🐬", "dolphin"], ["🐳", "whale"], ["🦈", "shark"], ["🐟", "fish"], ["🌹", "rose flower"], ["🌸", "cherry blossom"], ["🌻", "sunflower"], ["🌷", "tulip"], ["🌵", "cactus"], ["🌲", "tree evergreen"], ["🌳", "tree deciduous"], ["🍁", "maple leaf"], ["🍂", "fallen leaf"], ["🌙", "moon"], ["🌞", "sun"], ["⭐", "star"], ["☁️", "cloud"], ["⛅", "cloud sun"], ["🌧️", "rain"], ["❄️", "snow snowflake"], ["🌈", "rainbow"],
  ]},
  { name: "Travel & Places", emojis: [
    ["🚗", "car automobile"], ["🚕", "taxi"], ["🚙", "suv vehicle"], ["🚌", "bus"], ["🚑", "ambulance"], ["🚓", "police car"], ["🚒", "fire truck"], ["🏎️", "race car"], ["🚲", "bicycle"], ["🛵", "scooter"], ["🏍️", "motorcycle"], ["🚀", "rocket"], ["🛸", "ufo flying saucer"], ["✈️", "airplane plane"], ["🚁", "helicopter"], ["⛵", "sailboat"], ["🚤", "speedboat"], ["🛳️", "cruise ship"], ["⛺", "tent camping"], ["🏠", "house home"], ["🏢", "building office"], ["🏥", "hospital"], ["🏫", "school"], ["🏦", "bank"], ["🏪", "store shop"], ["🏟️", "stadium"], ["⛲", "fountain"], ["🗽", "statue liberty"], ["🗼", "tower tokyo"], ["🏰", "castle"], ["🎡", "ferris wheel"], ["🎢", "roller coaster"], ["🎠", "carousel"], ["🗺️", "map"], ["🧭", "compass"],
  ]},
  { name: "Objects", emojis: [
    ["⌚", "watch time"], ["📱", "phone mobile"], ["💻", "laptop computer"], ["⌨️", "keyboard"], ["🖥️", "desktop computer"], ["📷", "camera"], ["📸", "camera flash"], ["🎥", "video camera"], ["📺", "television tv"], ["📻", "radio"], ["⏰", "alarm clock"], ["🔋", "battery"], ["🔌", "plug"], ["💡", "light bulb idea"], ["🔦", "flashlight torch"], ["🔑", "key"], ["🔒", "lock locked"], ["🔓", "unlock open"], ["🛏️", "bed"], ["🚪", "door"], ["🎈", "balloon"], ["🎀", "ribbon bow"], ["🎊", "confetti ball"], ["📦", "package box"], ["📚", "books"], ["📝", "memo note"], ["✏️", "pencil"], ["📎", "paperclip"], ["📌", "pushpin"], ["📐", "ruler"], ["🔍", "magnifier search"], ["🔎", "magnifier search"], ["✂️", "scissors"], ["🧹", "broom"], ["🧺", "basket laundry"], ["🧻", "toilet paper"], ["🛒", "shopping cart"],
  ]},
  { name: "Symbols", emojis: [
    ["✅", "check mark correct"], ["❌", "cross wrong no"], ["⚠️", "warning caution"], ["❓", "question mark"], ["❗", "exclamation"], ["➕", "plus add"], ["➖", "minus subtract"], ["✖️", "multiply"], ["➗", "divide"], ["💰", "money bag"], ["💵", "dollar cash"], ["💳", "credit card"], ["♻️", "recycle"], ["⛔", "no entry stop"], ["🚫", "prohibited forbidden"], ["🔞", "18 no minors"], ["☮️", "peace"], ["♾️", "infinity"], ["🔔", "bell"], ["🔕", "bell off silent"], ["🎵", "music note"], ["🎶", "music notes"], ["🎤", "microphone"], ["🎧", "headphones"], ["📣", "megaphone"], ["📢", "loudspeaker"], ["🚩", "flag red triangular"], ["🏁", "checkered flag finish"], ["🏳️", "white flag surrender"], ["🏴", "black flag pirate"], ["🏳️‍🌈", "rainbow flag pride"], ["⏭️", "next skip"], ["⏮️", "previous"], ["▶️", "play"], ["⏸️", "pause"], ["⏹️", "stop"], ["☑️", "check box"], ["✔️", "check"], ["🔀", "shuffle"],
  ]},
];

type R = { emoji: string; count: number; mine: boolean };

export function ReactionBar({ kind, targetId, initial }: { kind: string; targetId: string; initial: R[] }) {
  const [rs, setRs] = useState<R[]>(initial);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  async function react(emoji: string) {
    setOpen(false);
    try { const r = await api("/api/reactions", { body: { kind, targetId, emoji } }); setRs(r.reactions ?? []); } catch { /* ignore */ }
  }
  const ql = q.trim().toLowerCase();
  const groups = useMemo(() => GROUPS.map((g) => ({
    name: g.name,
    emojis: ql ? g.emojis.filter(([e, n]) => n.toLowerCase().includes(ql) || e.includes(q)) : g.emojis,
  })).filter((g) => g.emojis.length > 0), [ql, q]);

  return (
    <div className="reactions">
      {rs.map((r) => (
        <button key={r.emoji} type="button" className={`reaction${r.mine ? " mine" : ""}`} onClick={() => react(r.emoji)} aria-label={`React ${r.emoji}`} title={r.emoji}>{r.emoji}{r.count > 1 ? <b>{r.count}</b> : null}</button>
      ))}
      <button type="button" className="reaction add" onClick={() => { setOpen((o) => !o); setQ(""); }} aria-label="Add reaction" aria-expanded={open} title="React">😊</button>
      {open && (
        <div className="reaction-picker" role="menu">
          <input className="rp-search" type="text" placeholder="Search emojis…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search emojis" />
          {groups.length === 0 && <p className="rp-empty">No emojis match &ldquo;{q}&rdquo;</p>}
          {groups.map((g) => (
            <div key={g.name} className="rp-group">
              <span className="rp-label">{g.name}</span>
              <div className="rp-emojis">{g.emojis.map(([e]) => <button key={e} type="button" onClick={() => react(e)}>{e}</button>)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
