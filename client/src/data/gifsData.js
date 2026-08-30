// Trending GIF categories and real-time Giphy search engine with instant curated fallback

export const GIF_REACTION_PILLS = [
  { id: 'trending', label: 'Trending', emoji: '🔥', query: 'trending' },
  { id: 'haha', label: 'Haha', emoji: '😂', query: 'funny lol laughing' },
  { id: 'love', label: 'Love', emoji: '❤️', query: 'love heart cute' },
  { id: 'yes', label: 'Agree', emoji: '👍', query: 'thumbs up agree nod' },
  { id: 'party', label: 'Party', emoji: '🎉', query: 'party celebrate dance' },
  { id: 'cry', label: 'Cry', emoji: '😭', query: 'sad cry crying tears' },
  { id: 'wow', label: 'Wow', emoji: '😲', query: 'shocked wow omg gasp' },
  { id: 'dance', label: 'Dance', emoji: '💃', query: 'happy dance groove vibing' },
  { id: 'facepalm', label: 'Facepalm', emoji: '🤦', query: 'facepalm smh bruh why' },
  { id: 'sus', label: 'Sus', emoji: '👀', query: 'suspicious side eye looking' },
  { id: 'salute', label: 'Salute', emoji: '🫡', query: 'salute respect yes sir' },
  { id: 'bye', label: 'Bye', emoji: '👋', query: 'wave goodbye bye see ya' }
];

export const RECENT_GIFS_KEY = 'zap_frequent_gifs';
export const MAX_RECENT_GIFS = 14;

// Curated high-availability GIF entries for instant offline fallback
export const CURATED_GIFS = [
  {
    id: 'g_cat_laugh',
    title: 'Laughing Cat',
    url: 'https://media.giphy.com/media/ICOgUNjpvO0PC/giphy.gif',
    thumb: 'https://media.giphy.com/media/ICOgUNjpvO0PC/200.gif',
    tags: ['haha', 'funny', 'laugh', 'cat', 'trending', 'lol']
  },
  {
    id: 'g_nod_agree',
    title: 'Agree Nodding',
    url: 'https://media.giphy.com/media/NEvPzZ8bd1V4Y/giphy.gif',
    thumb: 'https://media.giphy.com/media/NEvPzZ8bd1V4Y/200.gif',
    tags: ['yes', 'agree', 'nod', 'thumbs up', 'trending', 'respect']
  },
  {
    id: 'g_cheers_leo',
    title: 'Cheers Celebration',
    url: 'https://media.giphy.com/media/GCLlQnV7dXZ2E/giphy.gif',
    thumb: 'https://media.giphy.com/media/GCLlQnV7dXZ2E/200.gif',
    tags: ['party', 'cheers', 'celebrate', 'trending', 'toast']
  },
  {
    id: 'g_mind_blown',
    title: 'Mind Blown',
    url: 'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif',
    thumb: 'https://media.giphy.com/media/26ufdipQqU2lhNA4g/200.gif',
    tags: ['wow', 'mind blown', 'shocked', 'omg', 'brain', 'trending']
  },
  {
    id: 'g_heart_sparkle',
    title: 'Heart Love',
    url: 'https://media.giphy.com/media/L4lvBzeGQwpcFDOQNi/giphy.gif',
    thumb: 'https://media.giphy.com/media/L4lvBzeGQwpcFDOQNi/200.gif',
    tags: ['love', 'heart', 'crush', 'cute', 'hug', 'trending']
  },
  {
    id: 'g_vibing_cat',
    title: 'Vibing Cat',
    url: 'https://media.giphy.com/media/jpbnoe3UIa8TU8LM13/giphy.gif',
    thumb: 'https://media.giphy.com/media/jpbnoe3UIa8TU8LM13/200.gif',
    tags: ['dance', 'vibing', 'groove', 'music', 'party', 'cat', 'trending']
  },
  {
    id: 'g_eating_popcorn',
    title: 'Eating Popcorn',
    url: 'https://media.giphy.com/media/uWzS6ZLs0AaVO/giphy.gif',
    thumb: 'https://media.giphy.com/media/uWzS6ZLs0AaVO/200.gif',
    tags: ['popcorn', 'watch', 'drama', 'funny', 'trending', 'sus']
  },
  {
    id: 'g_side_eye',
    title: 'Suspicious Side Eye',
    url: 'https://media.giphy.com/media/H5C8CevNMbpBqNqFjl/giphy.gif',
    thumb: 'https://media.giphy.com/media/H5C8CevNMbpBqNqFjl/200.gif',
    tags: ['sus', 'suspicious', 'side eye', 'looking', 'trending']
  },
  {
    id: 'g_applause',
    title: 'Applause Clapping',
    url: 'https://media.giphy.com/media/fnK0jeA8vIh2QLq3IZ/giphy.gif',
    thumb: 'https://media.giphy.com/media/fnK0jeA8vIh2QLq3IZ/200.gif',
    tags: ['clap', 'applause', 'bravo', 'respect', 'yes', 'salute']
  },
  {
    id: 'g_facepalm',
    title: 'Facepalm',
    url: 'https://media.giphy.com/media/xsF1FSDbjguis/giphy.gif',
    thumb: 'https://media.giphy.com/media/xsF1FSDbjguis/200.gif',
    tags: ['facepalm', 'smh', 'why', 'bruh', 'tired']
  },
  {
    id: 'g_cry_cat',
    title: 'Crying Sad Cat',
    url: 'https://media.giphy.com/media/d2lcHJTG5Tscg/giphy.gif',
    thumb: 'https://media.giphy.com/media/d2lcHJTG5Tscg/200.gif',
    tags: ['cry', 'sad', 'tears', 'sob', 'cat']
  },
  {
    id: 'g_bye_wave',
    title: 'Waving Goodbye',
    url: 'https://media.giphy.com/media/kaq6GnxDlJaBq/giphy.gif',
    thumb: 'https://media.giphy.com/media/kaq6GnxDlJaBq/200.gif',
    tags: ['bye', 'wave', 'hello', 'goodbye', 'see ya']
  }
];

const GIPHY_API_KEY = 'sXpGFDGZs0Dv1mmNFvYaGUvYwKX0PWIh';

/**
 * High-speed Giphy Search: loads dozens of animated GIFs per search/pill with instant fallback.
 */
export async function fetchGifs(query = 'trending') {
  const clean = (query || '').trim().toLowerCase();
  const isTrending = !clean || clean === 'trending';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);

    const endpoint = isTrending
      ? `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=40&rating=g`
      : `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(clean)}&limit=40&rating=g`;

    const res = await fetch(endpoint, { signal: controller.signal });
    clearTimeout(timer);

    if (res.ok) {
      const json = await res.json();
      if (json && Array.isArray(json.data) && json.data.length > 0) {
        return json.data.map((item) => {
          const original = item.images?.original?.url || item.images?.downsized?.url || item.url;
          const thumb = item.images?.fixed_height?.url || item.images?.fixed_width?.url || item.images?.downsized_medium?.url || original;
          return {
            id: `giphy_${item.id}`,
            title: item.title || clean || 'GIF',
            url: original,
            thumb: thumb,
            tags: [clean]
          };
        });
      }
    }
  } catch (err) {
    // Network error or timeout -> fallback seamlessly
  }

  // Fallback to filtered offline list
  if (isTrending) {
    return CURATED_GIFS;
  }

  const matches = CURATED_GIFS.filter(g => {
    return g.tags.some(t => t.includes(clean) || clean.includes(t)) ||
           g.title.toLowerCase().includes(clean);
  });

  return matches.length > 0 ? matches : CURATED_GIFS;
}
