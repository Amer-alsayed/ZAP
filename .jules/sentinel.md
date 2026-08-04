## 2024-05-18 - [CRITICAL] Prevent Hardcoded Default JWT Secret Fallback in Production

**Vulnerability:**
The server configuration (`server/src/config.js`) contained a fallback to a hardcoded default JWT secret (`super-secure-chatra-secret-key-12345`) when `process.env.JWT_SECRET` was missing. Even though there was a console warning for production, the server would still start, which would allow attackers to easily forge valid JWT tokens for any user.

**Learning:**
Fallback configurations intended to ease local development can inadvertently become critical security vulnerabilities in production if they allow sensitive secrets to gracefully default to known insecure values.

**Prevention:**
Always fail securely. Applications should definitively crash or refuse to start in production if critical security configuration variables (like signing secrets, API keys, or database credentials) are missing, rather than attempting to self-recover with unsafe defaults.
