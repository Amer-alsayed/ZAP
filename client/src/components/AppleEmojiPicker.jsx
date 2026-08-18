import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Search, X, Delete, Smile } from 'lucide-react';

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

export default function AppleEmojiPicker({ onSelectEmoji, onDelete, onClose }) {
  const [activeCategory, setActiveCategory] = useState('smileys');
  const [searchQuery, setSearchQuery] = useState('');
  const scrollContainerRef = useRef(null);
  const searchInputRef = useRef(null);
  const isScrollingRef = useRef(false);

  // Search filter across all categories
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) {
      return EMOJI_CATEGORIES;
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
  }, [searchQuery]);

  // Jump smoothly to a category section
  const handleCategoryClick = useCallback((categoryId) => {
    setActiveCategory(categoryId);
    setSearchQuery('');
    const targetElement = document.getElementById(`apple-emoji-cat-${categoryId}`);
    if (targetElement && scrollContainerRef.current) {
      isScrollingRef.current = true;
      targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => {
        isScrollingRef.current = false;
      }, 400);
    }
  }, []);

  // Update active category tab based on scroll position
  const handleScroll = useCallback(() => {
    if (isScrollingRef.current || searchQuery) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    const scrollTop = container.scrollTop;
    for (let i = EMOJI_CATEGORIES.length - 1; i >= 0; i--) {
      const cat = EMOJI_CATEGORIES[i];
      const el = document.getElementById(`apple-emoji-cat-${cat.id}`);
      if (el && el.offsetTop - container.offsetTop <= scrollTop + 60) {
        setActiveCategory(cat.id);
        break;
      }
    }
  }, [searchQuery]);

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
            <div 
              key={category.id} 
              id={`apple-emoji-cat-${category.id}`} 
              className="apple-emoji-section"
            >
              <div className="apple-emoji-section-title">
                {category.name}
              </div>
              <div className="apple-emoji-grid">
                {category.emojis.map((emoji, idx) => (
                  <button
                    key={`${category.id}-${idx}-${emoji}`}
                    className="apple-emoji-btn"
                    onClick={(e) => {
                      e.preventDefault();
                      onSelectEmoji(emoji);
                    }}
                    title={emoji}
                    aria-label={`Insert ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Bottom Docked Apple Category Navigation Bar */}
      <div className="apple-emoji-dock-bar">
        {EMOJI_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            className={`apple-dock-tab ${activeCategory === cat.id && !searchQuery ? 'is-active' : ''}`}
            onClick={() => handleCategoryClick(cat.id)}
            title={cat.name}
            aria-label={cat.name}
          >
            <span className="apple-dock-icon">{cat.icon}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
