import React, { useState, useMemo, useRef } from 'react';
import { Search, X, Delete, Smile } from 'lucide-react';

export const EMOJI_CATEGORIES = [
  {
    id: 'smileys',
    name: 'Smileys & Emotion',
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
      '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '🤖', '👾'
    ]
  },
  {
    id: 'people',
    name: 'People & Body',
    icon: '👋',
    emojis: [
      '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', 
      '🫰', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', 
      '🫵', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '🫶', 
      '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦿', 
      '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🫀', '🫁', '🦷', '🦴', 
      '👀', '👁️', '👅', '👄', '🫦', '👶', '👧', '🧒', '👦', '👩', 
      '🧑', '👨', '👱‍♀️', '👱‍♂️', '👵', '🧓', '👴', '👲', '👳‍♀️', '👳‍♂️', 
      '🧕', '👮‍♀️', '👮‍♂️', '👷‍♀️', '👷‍♂️', '💂‍♀️', '💂‍♂️', '🕵️‍♀️', '🕵️‍♂️', '👩‍⚕️',
      '👨‍⚕️', '👩‍🎓', '👨‍🎓', '👩‍🏫', '👨‍🏫', '👩‍💻', '👨‍💻', '👩‍💼', '👨‍💼', '👩‍🔧',
      '👨‍🔧', '👩‍🔬', '👨‍🔬', '👩‍🚀', '👨‍🚀', '👩‍🚒', '👨‍🚒', '👸', '🤴', '🦸‍♀️',
      '🦸‍♂️', '🦹‍♀️', '🦹‍♂️', '🧙‍♀️', '🧙‍♂️', '🧚‍♀️', '🧚‍♂️', '🧛‍♀️', '🧛‍♂️', '🧜‍♀️'
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
    name: 'Activities & Sports',
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
    name: 'Objects & Tech',
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
      '🗓️', '📅', '📆', '📇', '🗃️', '🗳️', '🗄️', '📋', '📁', '📂', 
      '📰', '📓', '📕', '📗', '📘', '📙', '📚', '📖', '🔖', '🧷', 
      '🔗', '📎', '🖇️', '📌', '📍', '✂️', '🖊️', '🖋️', '✒️', '📝', 
      '✏️', '🔍', '🔎', '🔏', '🔐', '🔒', '🔓'
    ]
  },
  {
    id: 'symbols',
    name: 'Symbols & Hearts',
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
      '🈂️', '🛂', '🛃', '🛄', '🛅', '🚹', '🚺', '🚼', '🚻', '🚮', 
      '📶', '🈁', '🔣', 'ℹ️', '🔤', '🔡', '🔠', '🆖', '🆗', '🆙', 
      '🆒', '🆕', '🆓', '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', 
      '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟', '🔢', '#️⃣', '*️⃣', '⏏️', 
      '▶️', '⏸️', '⏯️', '⏹️', '⏺️', '⏭️', '⏮️', '⏩', '⏪', '⏫', 
      '⏬', '◀️', '🔼', '🔽', '➡️', '⬅️', '⬆️', '⬇️', '↗️', '↘️', 
      '↙️', '↖️', '↕️', '↔️', '↪️', '↩️', '⤴️', '⤵️', '🔀', '🔁', 
      '🔂', '🔄', '🔃', '🎵', '🎶', '➕', '➖', '➗', '✖️', '🟰', 
      '♾️', '💲', '💱', '™️', '©️', '®️', '👁️‍🗨️', '🔚', '🔙', '🔛', 
      '🔝', '🔜', '〰️', '➰', '➿', '✔️', '🔘', '🔴', '🟠', '🟡', 
      '🟢', '🔵', '🟣', '⚫️', '⚪️', '🟤', '🔺', '🔻', '🔸', '🔹', 
      '🔶', '🔷', '🔳', '🲲', '▪️', '▫️', '◾️', '◽️', '◼️', '◻️', 
      '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⬛️', '⬜️', '🟫', '🔈', 
      '🔉', '🔊', '🔇', '📣', '📢', '🔔', '🔕', '🃏', '🀄️', '♠️', 
      '♣️', '♥️', '♦️', '💭', '🗯️', '💬', '🗨️'
    ]
  }
];

export default function AppleEmojiPicker({ onSelectEmoji, onDelete, onClose }) {
  const [activeCategory, setActiveCategory] = useState('smileys');
  const [searchQuery, setSearchQuery] = useState('');
  const scrollContainerRef = useRef(null);
  const searchInputRef = useRef(null);

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

  const handleCategoryClick = (categoryId) => {
    setActiveCategory(categoryId);
    setSearchQuery('');
    const element = document.getElementById(`emoji-cat-${categoryId}`);
    if (element && scrollContainerRef.current) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="apple-emoji-picker-container glass" onClick={(e) => e.stopPropagation()}>
      {/* Top Header: Search & Quick Delete Action */}
      <div className="emoji-picker-header">
        <div className="emoji-search-wrapper">
          <Search size={15} className="emoji-search-icon" />
          <input
            ref={searchInputRef}
            type="text"
            className="emoji-search-input"
            placeholder="Search Emoji"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button 
              className="emoji-clear-search-btn" 
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
            className="emoji-backspace-btn" 
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
            className="emoji-close-btn" 
            onClick={onClose}
            title="Close emoji picker"
            aria-label="Close emoji picker"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Main Scrollable Emoji Grid Area */}
      <div className="emoji-grid-scroll-area" ref={scrollContainerRef}>
        {filteredCategories.length === 0 ? (
          <div className="emoji-no-results">
            <Smile size={32} style={{ opacity: 0.25, marginBottom: '8px' }} />
            <p>No matching emoji</p>
          </div>
        ) : (
          filteredCategories.map((category) => (
            <div key={category.id} id={`emoji-cat-${category.id}`} className="emoji-category-section">
              <div className="emoji-category-header">
                <span>{category.name}</span>
              </div>
              <div className="emoji-grid">
                {category.emojis.map((emoji, idx) => (
                  <button
                    key={`${category.id}-${idx}-${emoji}`}
                    className="emoji-item-btn"
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

      {/* Bottom Apple Category Switcher Bar */}
      <div className="emoji-category-bar">
        {EMOJI_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            className={`emoji-category-tab ${activeCategory === cat.id && !searchQuery ? 'active' : ''}`}
            onClick={() => handleCategoryClick(cat.id)}
            title={cat.name}
            aria-label={cat.name}
          >
            <span className="emoji-category-icon">{cat.icon}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
