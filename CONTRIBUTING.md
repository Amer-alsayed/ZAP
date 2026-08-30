# Contributing to ZAP

Thank you for your interest in contributing to ZAP! We welcome contributions from developers of all backgrounds.

---

## Development Setup

### Prerequisites
- **Node.js**: `v20.x` or `v22.x`
- **npm**: `v10.x` or higher
- **Docker** (optional, for turnkey container testing)

### Installation
```bash
# 1. Clone the repository
git clone https://github.com/Amer-alsayed/ZAP.git
cd ZAP

# 2. Install all dependencies for root, server, and client
npm run install:all

# 3. Start development servers (Backend :5000 + Frontend :5173)
npm run dev
```

---

## Testing & Quality Assurance

Before opening a pull request, ensure all cryptographic invariants and production builds pass without errors:

```bash
# 1. Run the automated cryptographic verification suite
npm run test:crypto

# 2. Build the client production bundle
npm run build --prefix client
```

---

## Pull Request Guidelines

1. **Keep PRs Focused**: Aim for atomic, self-contained pull requests.
2. **Preserve Backward Compatibility**: Never introduce breaking changes to database records, key derivation, or message decryption without fallback migration paths.
3. **Format & Cleanliness**: Ensure code follows standard modern React / ES Module conventions.
