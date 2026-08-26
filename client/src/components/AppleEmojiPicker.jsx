import React, { useState, useMemo, useRef, useEffect, useCallback, memo } from 'react';
import { Search, X, Delete, Smile } from 'lucide-react';

const RECENT_EMOJIS_KEY = 'chatra_frequent_emojis';
const MAX_RECENT_EMOJIS = 14; // Exactly 2 clean rows of 7 emojis (Apple iOS standard)
const DEFAULT_RECENT_EMOJIS = ['😂', '❤️', '🔥', '👍', '🙏', '😊', '😍', '✨', '🥺', '🎉', '👏', '🤣', '🥰', '💯'];

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
      '🚥', '🚏', '🗺️', '🗿', '🗽', '🗼', '🏰', '🏯', '🏟️', '🎡', 
      '🎢', '🎠', '⛲️', '⛱️', '🏖️', '🏝️', '🏜️', '🌋', '⛰️', '🏔️', 
      '🗻', '🏕️', '⛺️', '🛖', '🏠', '🏡', '🏘️', '🏚️', '🏗️', '🏭', 
      '🏢', '🏬', '🏣', '🏤', '🏥', '🏦', '🏨', '🏪', '🏫', '🏩'
    ]
  },
  {
    id: 'objects',
    name: 'Objects',
    icon: '💡',
    emojis: [
      '📱', '📲', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '🕹️', '💽', '💾', 
      '💿', '📀', '📼', '📷', '📸', '📹', '🎥', '📽️', '🎞️', '📞', 
      '☎️', '📟', '📠', '📺', '📻', '🎙️', '🎚️', '🎛️', '⏱️', '⏲️', 
      '⏰', '🕰️', '⌛️', '⏳', '📡', '🔋', '🪫', '🔌', '💡', '🔦', 
      '🕯️', '🧯', '🛢️', '💸', '💵', '💴', '💶', '💷', '🪙', '💰', 
      '💳', '💎', '⚖️', '🪜', '🧰', '🔧', '🔨', '⚒️', '🛠️', '⛏️', 
      '🪚', '🔩', '⚙️', '🧱', '⛓️', '🧲', '🔫', '💣', '🧨', '🪓', 
      '🔪', '🗡️', '⚔️', '🛡️', '🚬', '⚰️', '🪦', '🏺', '🔮', '💈', 
      '🔭', '🔬', '🩹', '🩺', '💊', '💉', '🩸', '🧬', '🧪', '🌡️', 
      '🧹', '🧺', '🧻', '🚽', '🚿', '🛁', '🧼', '🪥', '🪒', '🔑', 
      '🗝️', '🚪', '🪑', '🛋️', '🛏️', '🖼️', '🪞', '🪟', '🛍️', '🛒', 
      '🎁', '🎈', '🎉', '🎊', '✉️', '📩', '📨', '📧', '💌', '📦', 
      '🏷️', '📜', '📃', '📄', '📑', '🧾', '📊', '📈', '📉', '🗒️', 
      '🗓️', '📅', '📆', '📇', '🗃️', '🗳️', '🗄️', '📋', '📁', '📂'
    ]
  },
  {
    id: 'symbols',
    name: 'Symbols',
    icon: '❤️',
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
      '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', 
      '🔟', '🔢', '#️⃣', '*️⃣', '⏏️', '▶️', '⏸️', '⏯️', '⏹️', '⏺️', 
      '⏭️', '⏮️', '⏩', '⏪', '⏫', '⏬', '◀️', '🔼', '🔽', '➡️', 
      '⬅️', '⬆️', '⬇️', '↗️', '↘️', '↙️', '↖️', '↕️', '↔️', '↪️', 
      '↩️', '⤴️', '⤵️', '🔀', '🔁', '🔂', '🔄', '🔃', '🎵', '🎶'
    ]
  }
];

// Memoized Category Section Component with delegated event handling
const EmojiCategorySection = memo(function EmojiCategorySection({ category, onSelectEmoji }) {
  const handleGridClick = useCallback((e) => {
    const btn = e.target.closest('[data-emoji]');
    if (btn) {
      e.preventDefault();
      const emoji = btn.getAttribute('data-emoji');
      if (emoji) onSelectEmoji(emoji);
    }
  }, [onSelectEmoji]);

  // Prevent taps on emoji cells from stealing focus from the message input,
  // otherwise the mobile keyboard dismisses and immediately reopens on every pick.
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

const AppleEmojiPicker = memo(function AppleEmojiPicker({ onSelectEmoji, onDelete, onClose }) {
  const [recentEmojis, setRecentEmojis] = useState(() => {
    try {
      const saved = localStorage.getItem(RECENT_EMOJIS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.slice(0, MAX_RECENT_EMOJIS);
        }
      }
    } catch (e) {}
    return DEFAULT_RECENT_EMOJIS.slice(0, MAX_RECENT_EMOJIS);
  });

  const [activeCategory, setActiveCategory] = useState('recents');
  const [searchQuery, setSearchQuery] = useState('');
  // Start with only Frequently Used (14 cells) so the first commit after the button
  // click is tiny and the popover appears instantly; remaining categories ramp in
  // over the next few frames while the pop-in animation runs.
  const [renderedCategoryCount, setRenderedCategoryCount] = useState(1);
  const scrollContainerRef = useRef(null);
  const searchInputRef = useRef(null);
  const isScrollingRef = useRef(false);
  const rafIdRef = useRef(null);

  // Full list of categories including Frequently Used at top
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

  // Ramp remaining categories in across frames (small chunks keep the open animation
  // smooth while making the full grid scrollable within a few frames)
  useEffect(() => {
    if (renderedCategoryCount >= allCategoriesWithRecents.length) return;
    const frame = requestAnimationFrame(() => {
      setRenderedCategoryCount(prev => Math.min(prev + 2, allCategoriesWithRecents.length));
    });
    return () => cancelAnimationFrame(frame);
  }, [renderedCategoryCount, allCategoriesWithRecents.length]);

  // Dock items
  const dockCategories = useMemo(() => {
    return allCategoriesWithRecents.map(c => ({
      id: c.id,
      name: c.name,
      icon: c.icon
    }));
  }, [allCategoriesWithRecents]);

  // Search filter across categories
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) {
      return allCategoriesWithRecents.slice(0, renderedCategoryCount);
    }
    const query = searchQuery.trim().toLowerCase();
    return EMOJI_CATEGORIES.map(cat => {
      if (cat.name.toLowerCase().includes(query)) {
        return cat;
      }
      return {
        ...cat,
        emojis: cat.emojis.filter(e => e.includes(query))
      };
    }).filter(cat => cat.emojis.length > 0);
  }, [searchQuery, allCategoriesWithRecents, renderedCategoryCount]);

  // Record emoji selection into history / frequently used (capped at MAX_RECENT_EMOJIS).
  // Persist to localStorage right away, but do NOT reorder the visible "Frequently
  // Used" row mid-session — the fresh order is picked up the next time the picker
  // is opened (matches native iOS keyboard behavior and avoids rows jumping around
  // while the user is still tapping).
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
    } catch (e) {}
    onSelectEmoji(emoji);
  }, [onSelectEmoji, recentEmojis]);

  // Smooth gliding to target category section
  const handleCategoryClick = useCallback((categoryId) => {
    setActiveCategory(categoryId);
    setRenderedCategoryCount(allCategoriesWithRecents.length);
    if (searchQuery) setSearchQuery('');
    
    const container = scrollContainerRef.current;
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

  // High-performance RAF scroll watcher
  const handleScroll = useCallback(() => {
    if (isScrollingRef.current || searchQuery) return;
    if (rafIdRef.current) return;

    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const container = scrollContainerRef.current;
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
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  return (
    <div className="apple-emoji-picker-container glass" onClick={(e) => e.stopPropagation()}>
      {/* Top Header: iOS Search Bar & Actions */}
      <div className="apple-emoji-header">
        <div className="apple-emoji-search-bar">
          <Search size={15} className="apple-search-icon" />
          <input
            ref={searchInputRef}
            type="text"
            className="apple-search-input"
            placeholder="Search Emoji"
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

        {onDelete && (
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
            aria-label="Close emoji picker"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Unified Single Smooth Scrollable List */}
      <div 
        className="apple-emoji-scroll-body" 
        ref={scrollContainerRef}
        onScroll={handleScroll}
      >
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

      {/* Bottom Docked Apple Category Navigation Bar with Recents */}
      <AppleEmojiDock
        categories={dockCategories}
        activeCategory={activeCategory}
        onCategoryClick={handleCategoryClick}
        isSearching={Boolean(searchQuery)}
      />
    </div>
  );
});

export default AppleEmojiPicker;
