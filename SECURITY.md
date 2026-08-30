# Security Policy

## Supported Versions

We actively maintain and provide security updates for the following versions of ZAP:

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

---

## Reporting a Vulnerability

The security of ZAP and user privacy are our highest priorities. If you discover a vulnerability or potential cryptographic weakness, please disclose it responsibly:

1. **Do NOT open a public GitHub issue.**
2. Report the vulnerability via a [Private GitHub Security Advisory](https://github.com/Amer-alsayed/ZAP/security/advisories/new).
3. Include detailed steps to reproduce the issue, proof-of-concept payloads, and expected vs actual behavior.

---

## Cryptographic Commitments

- **Zero-Knowledge Principle**: The server never has access to raw passwords, plaintext messages, private keys, or unencrypted media.
- **Hardware-Accelerated Web Crypto API**: We exclusively use the native browser `window.crypto.subtle` implementation.
- **No Third-Party Analytics**: ZAP contains zero third-party trackers, analytics scripts, or telemetry.
