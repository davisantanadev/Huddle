"use strict";

// Signed updates. Every release publishes, next to Eco.zip:
//   manifest.json  {"version","sha256","size","publishedAt"} (exact bytes are signed)
//   manifest.sig   ECDSA P-256 / SHA-256 signature of those bytes, IEEE P1363
//                  (r||s, 64 bytes), base64
// The private key never touches the server or this repository (see
// docs/PUBLICAR.md); only the public key ships in the app. So someone who takes
// over the download server can't push their own "update" to everyone.
//
// ECDSA P-256 because the app (Node), the installer (C#, .NET Framework 4.7+)
// and install.ps1 (PowerShell 5.1) can all verify it with no extra library.

const crypto = require("crypto");

// More than one key may be listed to rotate keys: a new key is added in one
// release, signs from the next, and the old one is removed later.
const PUBLIC_KEYS = [
  `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAELsNkEIar9FnMrqzQ4PPBKGBOU+pp
nfco8GCfNpoaLnD5zCY5YmB+UgE/NebnXOUzEABwwJMxFDEVHdvJdDv1lg==
-----END PUBLIC KEY-----`,
  `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEZgzPHqLGm/2QSVqrbkq02bp6vQAo
yQIEduVrmiiIFCXTyLAf/9P4o6bz2zZcuYgTUBGO6XOxzurqNuWRe1TwdA==
-----END PUBLIC KEY-----`
];

function verifyManifestSignature(manifestBytes, signatureBase64, keys = PUBLIC_KEYS) {
  let sig;
  try {
    sig = Buffer.from(String(signatureBase64 || "").trim(), "base64");
  } catch (_) {
    return false;
  }
  if (sig.length !== 64) return false;
  return keys.some((pem) => {
    try {
      return crypto.verify("sha256", manifestBytes, { key: pem, dsaEncoding: "ieee-p1363" }, sig);
    } catch (_) {
      return false;
    }
  });
}

// "1.2.15" > "1.2.9"
function isNewerVersion(candidate, current) {
  const a = String(candidate).split(".").map(Number);
  const b = String(current).split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

// Checks the signature, then the content: returns the manifest or throws an
// Error whose message is a code ("signature", "manifest", "downgrade")
function readSignedManifest(manifestBytes, signatureBase64, currentVersion, keys = PUBLIC_KEYS) {
  if (!verifyManifestSignature(manifestBytes, signatureBase64, keys)) throw new Error("signature");
  let m;
  try {
    m = JSON.parse(Buffer.from(manifestBytes).toString("utf8"));
  } catch (_) {
    throw new Error("manifest");
  }
  if (!m || !/^\d+\.\d+\.\d+$/.test(String(m.version)) || !/^[0-9a-f]{64}$/.test(String(m.sha256)) || !(Number(m.size) > 0)) {
    throw new Error("manifest");
  }
  // Never "update" to the same or an older version (replay of an old, signed release)
  if (!isNewerVersion(m.version, currentVersion)) throw new Error("downgrade");
  return { version: String(m.version), sha256: String(m.sha256), size: Number(m.size) };
}

module.exports = { PUBLIC_KEYS, verifyManifestSignature, readSignedManifest, isNewerVersion };
