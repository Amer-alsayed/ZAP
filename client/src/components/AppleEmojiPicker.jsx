import React, { useState, useMemo, useRef, useEffect, useCallback, memo } from 'react';
import { Search, X, Delete, Smile, Film, Loader2 } from 'lucide-react';
import { useElasticBounce } from '../hooks/useElasticBounce';
import { GIF_REACTION_PILLS, RECENT_GIFS_KEY, MAX_RECENT_GIFS, fetchGifs } from '../data/gifsData';

const RECENT_EMOJIS_KEY = 'chatra_frequent_emojis';
const MAX_RECENT_EMOJIS = 14; // Exactly 2 clean rows of 7 emojis (Apple iOS standard)
const DEFAULT_RECENT_EMOJIS = ['😂', '❤️', '🔥', '👍', '🙏', '😊', '😍', '✨', '🥺', '🎉', '👏', '🤣', '🥰', '💯'];

const EMOJI_KEYWORDS = {
  '🔥': ['fire', 'flame', 'lit', 'hot'],
  '😂': ['joy', 'laugh', 'crying', 'funny', 'tears', 'lol', 'haha'],
  '❤️': ['heart', 'love', 'red'],
  '👍': ['thumbs up', 'like', 'agree', 'approve', 'yes', 'good'],
  '🙏': ['pray', 'please', 'thanks', 'thank you', 'namaste', 'hope'],
  '😊': ['smile', 'happy', 'blush', 'pleased'],
  '😍': ['heart eyes', 'love', 'adore', 'crush'],
  '✨': ['sparkles', 'stars', 'magic', 'shine', 'clean'],
  '🥺': ['pleading', 'puppy eyes', 'beg', 'cute'],
  '🎉': ['party', 'celebration', 'tada', 'congrats'],
  '👏': ['clap', 'applause', 'bravo', 'hands'],
  '🤣': ['rofl', 'laugh', 'rolling', 'funny', 'haha'],
  '🥰': ['hearts', 'love', 'warm', 'affection'],
  '💯': ['100', 'hundred', 'score', 'perfect'],
  '😀': ['grinning', 'smile', 'happy'],
  '😃': ['happy', 'smiley', 'big smile'],
  '😄': ['smile', 'laugh', 'joy'],
  '😁': ['beam', 'grin', 'teeth'],
  '😆': ['laughing', 'closed eyes', 'satisfied'],
  '😅': ['sweat smile', 'relief', 'nervous'],
  '🙂': ['slight smile', 'fine', 'ok'],
  '😉': ['wink', 'flirt', 'joke'],
  '😇': ['innocent', 'angel', 'halo'],
  '🤩': ['star struck', 'excited', 'wow'],
  '😘': ['kiss', 'blow kiss', 'love'],
  '😋': ['yum', 'delicious', 'tasty', 'silly'],
  '😎': ['cool', 'sunglasses', 'awesome'],
  '🤔': ['thinking', 'wonder', 'hmm'],
  '😴': ['sleeping', 'tired', 'sleep', 'zzz'],
  '😭': ['sob', 'crying', 'sad', 'tears'],
  '😡': ['angry', 'mad', 'furious'],
  '💩': ['poop', 'poo', 'crap'],
  '👻': ['ghost', 'halloween', 'spooky'],
  '💀': ['skull', 'dead', 'skeleton', 'death'],
  '🐶': ['dog', 'puppy', 'pet'],
  '🐱': ['cat', 'kitty', 'pet'],
  '🚀': ['rocket', 'space', 'launch', 'fast'],
  '⭐': ['star', 'favorite'],
  '🌟': ['glowing star', 'shine', 'sparkle'],
  '🍕': ['pizza', 'food', 'cheese'],
  '🍔': ['burger', 'hamburger', 'fast food'],
  '☕️': ['coffee', 'tea', 'cafe', 'drink'],
  '🍺': ['beer', 'drink', 'cheers'],
  '⚽️': ['soccer', 'football', 'ball', 'sport'],
  '🎮': ['game', 'controller', 'video game', 'gaming'],
  '🚗': ['car', 'drive', 'auto', 'vehicle'],
  '✈️': ['airplane', 'plane', 'flight', 'travel'],
  '📱': ['phone', 'mobile', 'iphone', 'cell']
};

export const EMOJI_CATEGORIES = [
  {
    id: 'smileys',
    name: 'Smileys & People',
    icon: '😀',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', 
      '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😋', 
      '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', 
      '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌',
      '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', 
      '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '🥸', '😎', '🤓', 
      '🧐', '😕', '😟', '🙁', '😮', '😯', '😲', '😳', '🥺', '😦', 
      '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', 
      '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', 
      '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '🤖', '👾',
      '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', 
      '🫰', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', 
      '🫵', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '🫶', 
      '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦿', 
      '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🫀', '🫁', '🦷', '🦴', 
      '👀', '👁️', '👅', '👄', '🫦', '👶', '👧', '🧒', '👦', '👩', 
      '🧑', '👨', '👱‍♀️', '👱‍♂️', '👵', '🧓', '👴', '👲', '👳‍♀️', '👳‍♂️', 
      '🧕', '👮‍♀️', '👮‍♂️', '👷‍♀️', '👷‍♂️', '💂‍♀️', '💂‍♂️', '🕵️‍♀️', '🕵️‍♂️', '👩‍⚕️'
    ]
  },
  {
    id: 'nature',
    name: 'Animals & Nature',
    icon: '🐶',
    emojis: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐻‍❄️', '🐨', 
      '🐯', '🦁', '🐮', '🐷', '🐽', '🐸', '🐵', '🙈', '🙉', '🙊', 
      '🐒', '🐔', '🐧', '🐦', '🐤', '🐣', '🐥', '🦆', '🦅', '🦉', 
      '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🪱', '🐛', '🦋', '🐌', 
      '🐞', '🐜', '🪰', '🪲', '🪳', '🦟', '🦗', '🕷️', '🕸️', '🦂', 
      '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', 
      '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🦭', '🐊', '🐅', 
      '🐆', '🦓', '🦍', '🦧', '🦣', '🐘', '🦛', '🦏', '🐪', '🐫', 
      '🦒', '🦘', '🦬', '🐃', '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', 
      '🌲', '🌳', '🌴', '🪵', '🌱', '🌿', '☘️', '🍀', '🎍', '🪴',
      '🎋', '🍃', '🍂', '🍁', '🍄', '🐚', '🪨', '🌾', '💐', '🌷',
      '🌹', '🥀', '🌺', '🌸', '🌼', '🌻', '🌞', '🌝', '⭐', '🌟',
      '✨', '⚡️', '☄️', '💥', '🔥', '🌈', '☀️', '🌤️', '⛅️', '☁️',
      '🌧️', '⛈️', '🌩️', '🌨️', '❄️', '☃️', '🌬️', '💨', '💧', '💦'
    ]
  },
  {
    id: 'food',
    name: 'Food & Drink',
    icon: '🍔',
    emojis: [
      '🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', 
      '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', 
      '🥦', '🥬', '🥒', '🌶️', '🫑', '🌽', '🥕', '🫒', '🧄', '🧅', 
      '🥔', '🍠', '🥐', '🥯', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳', 
      '🧈', '🥞', '🧇', '🥓', '🥩', '🍗', '🍖', '🦴', '🌭', '🍔', 
      '🍟', '🍕', '🫓', '🥪', '🥙', '🧆', '🌮', '🌯', '🫔', '🥗', 
      '🥘', '🫕', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🦪', 
      '🍤', '🍙', '🍚', '🍘', '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', 
      '🍨', '🍦', '🥧', '🧁', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', 
      '🍿', '🍩', '🍪', '🌰', '🥜', '🍯', '🥛', '🍼', '🫖', '☕️',
      '🍵', '🧃', '🥤', '🧋', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸',
      '🍹', '🧉', '🍾', '🧊'
    ]
  },
  {
    id: 'activities',
    name: 'Activity',
    icon: '⚽️',
    emojis: [
      '⚽️', '🏀', '🏈', '⚾️', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', 
      '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅', '⛳️', 
      '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', 
      '⛸️', '🥌', '🎿', '⛷️', '🏂', '🪂', '🏋️‍♀️', '🏋️‍♂️', '🤼‍♀️', '🤼‍♂️', 
      '🤸‍♀️', '🤸‍♂️', '⛹️‍♀️', '⛹️‍♂️', '🤺', '🤾‍♀️', '🤾‍♂️', '🏌️‍♀️', '🏌️‍♂️', '🏇', 
      '🧘‍♀️', '🧘‍♂️', '🏄‍♀️', '🏄‍♂️', '🏊‍♀️', '🏊‍♂️', '🤽‍♀️', '🤽‍♂️', '🚣‍♀️', '🚣‍♂️', 
      '🧗‍♀️', '🧗‍♂️', '🚵‍♀️', '🚵‍♂️', '🚴‍♀️', '🚴‍♂️', '🏆', '🥇', '🥈', '🥉', 
      '🏅', '🎖️', '🏵️', '🎗️', '🎫', '🎟️', '🎪', '🤹', '🎭', '🩰', 
      '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🪘', '🎷', '🎺', 
      '🪗', '🎸', '🪕', '🎻', '🎲', '♟️', '🎯', '🎳', '🎮', '🎰'
    ]
  },
  {
    id: 'travel',
    name: 'Travel & Places',
    icon: '✈️',
    emojis: [
      '🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', 
      '🛻', '🚚', '🚛', '🚜', '🛴', '🚲', '🛵', '🏍️', '🛺', '🚨', 
      '🚔', '🚍', '🚘', '🚖', '🚡', '🚠', '🚟', '🚃', '🚋', '🚞', 
      '🚝', '🚄', '🚅', '🚈', '🚂', '🚆', '🚇', '🚊', '🚉', '✈️', 
      '🛫', '🛬', '🛩️', '💺', '🛰️', '🚀', '🛸', '🚁', '🛶', '⛵️', 
      '🚤', '🛥️', '🛳️', '⛴️', '🚢', '⚓️', '🛟', '⛽️', '🚧', '🚦', 
      '🚥', '🗺️', '🗿', '🗽', '🗼', '🏰', '🏯', '🏟️', '🎡', '🎢', 
      '🎠', '⛲️', '⛱️', '🏖️', '🏝️', '🏜️', '🌋', '⛰️', '🏔️', '🗻', 
      '🏕️', '⛺️', '🛖', '🏠', '🏡', '🏘️', '🏚️', '🏗️', '🏭', '🏢', 
      '🏬', '🏣', '🏤', '🏥', '🏦', '🏨', '🏪', '🏫', '🏩', '💒', 
      '🏛️', '⛪️', '🕌', '🛕', '🕍', '⛩️', '🕋'
    ]
  },
  {
    id: 'objects',
    name: 'Objects',
    icon: '💡',
    emojis: [
      '⌚️', '📱', '📲', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '🖲️', '🕹️', 
      '🗜️', '💽', '💾', '💿', '📀', '📼', '📷', '📸', '📹', '🎥', 
      '📽️', '🎞️', '📞', '☎️', '📟', '📠', '📺', '📻', '🎙️', '🎚️', 
      '🎛️', '🧭', '⏱️', '⏲️', '⏰', '🕰️', '⌛️', '⏳', '📡', '🔋', 
      '🪫', '🔌', '💡', '🔦', '🕯️', '🪔', '🧯', '🛢️', '💸', '💵', 
      '💴', '💶', '💷', '🪙', '💰', '💳', '💎', '⚖️', '🪜', '🧰', 
      '🪛', '🔧', '🔨', '⚒️', '🛠️', '⛏️', '🪚', '🔩', '⚙️', '🪤', 
      '🧱', '⛓️', '🧲', '🔫', '💣', '🧨', '🪓', '🔪', '🗡️', '⚔️', 
      '🛡️', '🚬', '⚰️', '🪦', '⚱️', '🏺', '🔮', '📿', '🧿', '💈', 
      '⚗️', '🔭', '🔬', '🕳️', '🩹', '🩺', '🩻', '🩼', '💊', '💉', 
      '🩸', '🧬', '🦠', '🧫', '🧪', '🌡️', '🧹', '🪠', '🧺', '🧻'
    ]
  },
  {
    id: 'symbols',
    name: 'Symbols',
    icon: '🔣',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', 
      '❤️‍🔥', '❤️‍🩹', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', 
      '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', 
      '☦️', '🛐', '⛎', '♈️', '♉️', '♊️', '♋️', '♌️', '♍️', '♎️', 
      '♏️', '♐️', '♑️', '♒️', '♓️', '🆔', '⚛️', '🉑', '☢️', '☣️', 
      '📴', '📳', '🈶', '🈚️', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', 
      '🉐', '㊙️', '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎', 
      '🆑', '🅾️', '🆘', '❌', '⭕️', '🛑', '⛔️', '📛', '🚫', '💯', 
      '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗️', 
      '❕', '❓', '❔', '‼️', '⁉️', '🔅', '🔆', '〽️', '⚠️', '🚸', 
      '🔱', '⚜️', '🔰', '♻️', '✅', '🈯️', '💹', '❇️', '✳️', '❎', 
      '🌐', '💠', 'Ⓜ️', '🌀', '💤', '🏧', '🚾', '♿️', '🅿️', '🈳', 
      '🈂️', '🛂', '🛃', '🛄', '🛅', '🚹', '🚺', '🚼', '⚧️', '🚻', 
      '🚮', '🎦', '📶', '🈁', '🆖', '🆗', '🆙', '🆒', '🆕', '🆓', 
      '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', 
      '🔟', '🔢', '#️⃣', '*️⃣', '⏏️', '▶️', '⏸️', '⏯️', '⏹️', '⏺️', 
      '⏭️', '⏮️', '⏩', '⏪', '⏫', '⏬', '◀️', '🔼', '🔽', '➡️', 
      '⬅️', '⬆️', '⬇️', '↗️', '↘️', '↙️', '↖️', '↕️', '↔️', '↪️', 
      '↩️', '⤴️', '⤵️', '🔀', '🔁', '🔂', '🔄', '🔃', '🎵', '🎶'
    ]
  }
];

// Memoized Category Section Component for Emojis
const EmojiCategorySection = memo(function EmojiCategorySection({ category, onSelectEmoji }) {
  const handleGridClick = useCallback((e) => {
    const btn = e.target.closest('[data-emoji]');
    if (btn) {
      e.preventDefault();
      const emoji = btn.getAttribute('data-emoji');
      if (emoji) onSelectEmoji(emoji);
    }
  }, [onSelectEmoji]);

  const handleGridPointerDown = useCallback((e) => {
    e.preventDefault();
  }, []);

  return (
    <div 
      id={`apple-emoji-cat-${category.id}`} 
      className="apple-emoji-section"
    >
      <div className="apple-emoji-section-title">
        {category.name}
      </div>
      <div
        className="apple-emoji-grid"
        onClick={handleGridClick}
        onPointerDown={handleGridPointerDown}
        onMouseDown={handleGridPointerDown}
      >
        {category.emojis.map((emoji, idx) => (
          <div
            key={`${category.id}-${idx}-${emoji}`}
            className="apple-emoji-btn"
            role="button"
            data-emoji={emoji}
            title={emoji}
            aria-label={`Insert ${emoji}`}
          >
            {emoji}
          </div>
        ))}
      </div>
    </div>
  );
});

// Memoized Apple Dock Bar
const AppleEmojiDock = memo(function AppleEmojiDock({ categories, activeCategory, onCategoryClick, isSearching }) {
  return (
    <div className="apple-emoji-dock-bar">
      {categories.map((cat) => (
        <button
          key={cat.id}
          className={`apple-dock-tab ${activeCategory === cat.id && !isSearching ? 'is-active' : ''}`}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => onCategoryClick(cat.id)}
          title={cat.name}
          aria-label={cat.name}
        >
          <span className="apple-dock-icon">{cat.icon}</span>
        </button>
      ))}
    </div>
  );
});

const AppleEmojiPicker = memo(function AppleEmojiPicker({ 
  onSelectEmoji, 
  onSelectGif, 
  onDelete, 
  onClose 
}) {
  // Mode Switcher: 'emojis' | 'gifs'
  const [activeTab, setActiveTab] = useState(() => {
    try {
      const saved = localStorage.getItem('chatra_picker_tab');
      return saved === 'gifs' ? 'gifs' : 'emojis';
    } catch {
      return 'emojis';
    }
  });

  const handleTabChange = (newTab) => {
    setActiveTab(newTab);
    setSearchQuery('');
    try {
      localStorage.setItem('chatra_picker_tab', newTab);
    } catch {}
  };

  // Search input state
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef(null);

  // --- EMOJIS STATE ---
  const [recentEmojis, setRecentEmojis] = useState(() => {
    try {
      const saved = localStorage.getItem(RECENT_EMOJIS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.slice(0, MAX_RECENT_EMOJIS);
        }
      }
    } catch {}
    return DEFAULT_RECENT_EMOJIS.slice(0, MAX_RECENT_EMOJIS);
  });

  const [activeCategory, setActiveCategory] = useState('recents');
  const [renderedCategoryCount, setRenderedCategoryCount] = useState(1);
  const emojiScrollRef = useRef(null);
  const emojiBounceRef = useRef(null);
  const isScrollingRef = useRef(false);
  const emojiRafRef = useRef(null);

  useElasticBounce(emojiScrollRef, emojiBounceRef, activeTab === 'emojis');

  // --- GIFS STATE ---
  const [activeGifPill, setActiveGifPill] = useState('trending');
  const [gifsList, setGifsList] = useState([]);
  const [isLoadingGifs, setIsLoadingGifs] = useState(false);
  const gifScrollRef = useRef(null);
  const gifBounceRef = useRef(null);

  useElasticBounce(gifScrollRef, gifBounceRef, activeTab === 'gifs');

  // Fetch GIFs on query or pill change
  useEffect(() => {
    if (activeTab !== 'gifs') return;
    let active = true;
    setIsLoadingGifs(true);

    const queryToFetch = searchQuery.trim() || activeGifPill;
    fetchGifs(queryToFetch).then((results) => {
      if (active) {
        setGifsList(results);
        setIsLoadingGifs(false);
      }
    });

    return () => {
      active = false;
    };
  }, [activeTab, searchQuery, activeGifPill]);

  // Full list of emoji categories including Frequently Used
  const allCategoriesWithRecents = useMemo(() => {
    const list = [];
    if (recentEmojis.length > 0) {
      list.push({
        id: 'recents',
        name: 'Frequently Used',
        icon: '🕒',
        emojis: recentEmojis.slice(0, MAX_RECENT_EMOJIS)
      });
    }
    return [...list, ...EMOJI_CATEGORIES];
  }, [recentEmojis]);

  // Ramp remaining emoji categories
  useEffect(() => {
    if (activeTab !== 'emojis' || renderedCategoryCount >= allCategoriesWithRecents.length) return;
    const frame = requestAnimationFrame(() => {
      setRenderedCategoryCount(prev => Math.min(prev + 2, allCategoriesWithRecents.length));
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTab, renderedCategoryCount, allCategoriesWithRecents.length]);

  const dockCategories = useMemo(() => {
    return allCategoriesWithRecents.map(c => ({
      id: c.id,
      name: c.name,
      icon: c.icon
    }));
  }, [allCategoriesWithRecents]);

  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) {
      return allCategoriesWithRecents.slice(0, renderedCategoryCount);
    }
    const query = searchQuery.trim().toLowerCase();
    return EMOJI_CATEGORIES.map(cat => {
      const isCatMatch = cat.name.toLowerCase().includes(query);
      if (isCatMatch) return cat;

      const matchingEmojis = cat.emojis.filter(e => {
        if (e.includes(query)) return true;
        const keywords = EMOJI_KEYWORDS[e];
        if (keywords && keywords.some(k => k.toLowerCase().includes(query))) return true;
        return false;
      });

      return {
        ...cat,
        emojis: matchingEmojis
      };
    }).filter(cat => cat.emojis.length > 0);
  }, [searchQuery, allCategoriesWithRecents, renderedCategoryCount]);

  // Emoji selection handler
  const handleSelectEmojiWithTracking = useCallback((emoji) => {
    try {
      const saved = localStorage.getItem(RECENT_EMOJIS_KEY);
      let prev = recentEmojis;
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) prev = parsed;
      }
      const updated = [emoji, ...prev.filter(e => e !== emoji)].slice(0, MAX_RECENT_EMOJIS);
      localStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(updated));
    } catch {}
    if (onSelectEmoji) onSelectEmoji(emoji);
  }, [onSelectEmoji, recentEmojis]);

  // GIF selection handler
  const handleSelectGifWithTracking = useCallback((gif) => {
    try {
      const saved = localStorage.getItem(RECENT_GIFS_KEY);
      let prev = [];
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) prev = parsed;
      }
      const updated = [gif, ...prev.filter(g => g.id !== gif.id)].slice(0, MAX_RECENT_GIFS);
      localStorage.setItem(RECENT_GIFS_KEY, JSON.stringify(updated));
    } catch {}

    if (onSelectGif) {
      onSelectGif(gif);
    }
  }, [onSelectGif]);

  // Category navigation click (Emojis)
  const handleEmojiCategoryClick = useCallback((categoryId) => {
    setActiveCategory(categoryId);
    setRenderedCategoryCount(allCategoriesWithRecents.length);
    if (searchQuery) setSearchQuery('');
    
    const container = emojiScrollRef.current;
    const targetElement = document.getElementById(`apple-emoji-cat-${categoryId}`);
    if (targetElement && container) {
      isScrollingRef.current = true;
      const targetTop = targetElement.offsetTop - container.offsetTop;
      container.scrollTo({
        top: Math.max(0, targetTop - 6),
        behavior: 'smooth'
      });
      setTimeout(() => {
        isScrollingRef.current = false;
      }, 350);
    }
  }, [searchQuery, allCategoriesWithRecents.length]);

  // Scroll watcher for active category in Emojis
  const handleEmojiScroll = useCallback(() => {
    if (isScrollingRef.current || searchQuery) return;
    if (emojiRafRef.current) return;

    emojiRafRef.current = requestAnimationFrame(() => {
      emojiRafRef.current = null;
      const container = emojiScrollRef.current;
      if (!container) return;

      const scrollTop = container.scrollTop;
      const containerTop = container.offsetTop;

      for (let i = allCategoriesWithRecents.length - 1; i >= 0; i--) {
        const cat = allCategoriesWithRecents[i];
        const el = document.getElementById(`apple-emoji-cat-${cat.id}`);
        if (el && (el.offsetTop - containerTop) <= scrollTop + 60) {
          setActiveCategory(prev => (prev !== cat.id ? cat.id : prev));
          break;
        }
      }
    });
  }, [searchQuery, allCategoriesWithRecents]);

  useEffect(() => {
    return () => {
      if (emojiRafRef.current) {
        cancelAnimationFrame(emojiRafRef.current);
      }
    };
  }, []);

  const searchPlaceholder = useMemo(() => {
    if (activeTab === 'gifs') return 'Search GIFs on Tenor…';
    return 'Search Emoji';
  }, [activeTab]);

  return (
    <div className="apple-emoji-picker-container glass" onClick={(e) => e.stopPropagation()}>
      {/* 1. Top Mode Switcher Tabs (Exact Same Sliding Spring Pill as Calls All / Missed) */}
      <div className="expression-picker-tabs-container">
        <div className="expression-segmented-control">
          <div 
            className="expression-segmented-slider" 
            style={{ 
              transform: activeTab === 'gifs' ? 'translateX(100%)' : 'translateX(0)' 
            }} 
          />
          <button
            type="button"
            className={`expression-control-btn ${activeTab === 'emojis' ? 'active' : ''}`}
            onClick={() => handleTabChange('emojis')}
          >
            <Smile size={15} />
            <span>Emojis</span>
          </button>

          <button
            type="button"
            className={`expression-control-btn ${activeTab === 'gifs' ? 'active' : ''}`}
            onClick={() => handleTabChange('gifs')}
          >
            <Film size={15} />
            <span>GIFs</span>
          </button>
        </div>
      </div>

      {/* 2. Top Header: Search Bar & Actions */}
      <div className="apple-emoji-header">
        <div className="apple-emoji-search-bar">
          <Search size={15} className="apple-search-icon" />
          <input
            ref={searchInputRef}
            type="text"
            className="apple-search-input"
            placeholder={searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button 
              className="apple-search-clear-btn" 
              onClick={() => {
                setSearchQuery('');
                searchInputRef.current?.focus();
              }}
              title="Clear search"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {onDelete && activeTab === 'emojis' && (
          <button 
            className="apple-backspace-btn" 
            onPointerDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.preventDefault();
              onDelete();
            }}
            title="Delete character"
            aria-label="Delete character"
          >
            <Delete size={17} />
          </button>
        )}

        {onClose && (
          <button 
            className="apple-close-btn" 
            onClick={onClose}
            title="Close"
            aria-label="Close picker"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* 3. TAB CONTENT: EMOJIS */}
      {activeTab === 'emojis' && (
        <>
          <div 
            className="apple-emoji-scroll-body" 
            ref={emojiScrollRef}
            onScroll={handleEmojiScroll}
          >
            <div className="emoji-bounce-wrapper" ref={emojiBounceRef}>
              {filteredCategories.length === 0 ? (
                <div className="apple-emoji-empty-state">
                  <Smile size={32} style={{ opacity: 0.25, marginBottom: '8px' }} />
                  <p>No Results Found</p>
                </div>
              ) : (
                filteredCategories.map((category) => (
                  <EmojiCategorySection
                    key={category.id}
                    category={category}
                    onSelectEmoji={handleSelectEmojiWithTracking}
                  />
                ))
              )}
            </div>
          </div>

          <AppleEmojiDock
            categories={dockCategories}
            activeCategory={activeCategory}
            onCategoryClick={handleEmojiCategoryClick}
            isSearching={Boolean(searchQuery)}
          />
        </>
      )}

      {/* 4. TAB CONTENT: GIFS */}
      {activeTab === 'gifs' && (
        <div className="apple-gifs-wrapper">
          {/* Reaction Quick Filter Pills */}
          <div className="gif-pills-scroll-row">
            {GIF_REACTION_PILLS.map((pill) => (
              <button
                key={pill.id}
                type="button"
                className={`gif-pill-btn ${activeGifPill === pill.query && !searchQuery ? 'is-active' : ''}`}
                onClick={() => {
                  setSearchQuery('');
                  setActiveGifPill(pill.query);
                }}
              >
                <span>{pill.emoji}</span>
                <span>{pill.label}</span>
              </button>
            ))}
          </div>

          {/* GIF Masonry Grid */}
          <div className="apple-emoji-scroll-body gifs-scroll-body" ref={gifScrollRef}>
            <div className="emoji-bounce-wrapper" ref={gifBounceRef}>
              {isLoadingGifs ? (
                <div className="gifs-loading-state">
                  <Loader2 size={24} className="spinner-rotating" />
                  <span>Loading animated GIFs…</span>
                </div>
              ) : gifsList.length === 0 ? (
                <div className="apple-emoji-empty-state">
                  <Film size={32} style={{ opacity: 0.25, marginBottom: '8px' }} />
                  <p>No GIFs Found</p>
                </div>
              ) : (
                <div className="gifs-masonry-grid">
                  {gifsList.map((gif) => (
                    <button
                      key={gif.id}
                      type="button"
                      className="gif-grid-item"
                      onClick={() => handleSelectGifWithTracking(gif)}
                      title={gif.title}
                      aria-label={`Send GIF: ${gif.title}`}
                    >
                      <img 
                        src={gif.thumb || gif.url} 
                        alt={gif.title} 
                        className="gif-grid-img" 
                        loading="lazy" 
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default AppleEmojiPicker;
