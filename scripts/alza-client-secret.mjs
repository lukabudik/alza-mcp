#!/usr/bin/env node
/**
 * Decodes the Alza `alza_Android` OAuth client secret embedded in the mobile APK.
 *
 * Source (decompiled `cz.alza.eshop`, 2026.15 and 2026.17 — identical constants):
 *   ph1.a()  = e0( zlp.c( hop.o(), g0("QaUXkh4j7MHGgclj0oEW"), new byte[16] ) )
 *   hop.o()  = hex-decode("970938944c92db9bf5e329905fb9ab6cca6fb29b80ea60a65aff9f8eb4a1c516")
 *   zlp.c    = AES variant: 20-byte key (Nk=5), Nr=11 rounds, table-driven
 *              equivalent-inverse-cipher core, CBC mode, zero IV (defpackage/f.java
 *              + defpackage/zlp.c). The two 16-byte plaintext blocks are both ASCII.
 *
 * Usage: node scripts/alza-client-secret.mjs   → prints the 32-char client secret.
 * The value is consumed by `scripts/e2e-order-payment.browser.mjs exchange`
 * (the token endpoint rejects `alza_Android` requests without it: invalid_client).
 */
const MASK = 0xff;
const T = 0x01010100; // android.R.attr.transcriptMode (R8 constant-hiding)
const C = 0x01010101; // android.R.attr.cacheColorHint (R8 constant-hiding)
const q = [0, 1, 2, 4, 8, 16, 32, 64, 128, 27, 54];

// defpackage/f.java static init (S-box g/h + mixcols tables m/n/o/p)
const g = new Int32Array(256), h = new Int32Array(256),
  m = new Int32Array(256), n = new Int32Array(256), o = new Int32Array(256), p = new Int32Array(256);
{
  const xtime = new Int32Array(256);
  for (let x = 0; x < 256; x++) xtime[x] = x >= 128 ? (x << 1) ^ 283 : x << 1;
  let i3 = 0, i4 = 0;
  for (let it = 0; it < 256; it++) {
    const i6 = ((i3 << 1) ^ i3) ^ (i3 << 2) ^ (i3 << 3) ^ (i3 << 4);
    const i7 = ((i6 & 0xff) ^ (i6 >>> 8) ^ 99) & 0xff;
    g[i4] = i7; h[i7] = i4;
    const i8 = xtime[i4], i9 = xtime[i8], i10 = xtime[i9];
    const i12 = ((i9 * 65537) ^ (C * i10)) ^ (i8 * 257) ^ (T * i4);
    m[i7] = (i12 << 24) | (i12 >>> 8);
    n[i7] = (i12 << 16) | (i12 >>> 16);
    o[i7] = (i12 << 8) | (i12 >>> 24);
    p[i7] = i12;
    if (i4 === 0) { i3 = 1; i4 = 1; } else {
      i4 = xtime[xtime[xtime[i10 ^ i8]]] ^ i8;
      i3 ^= xtime[xtime[i3]];
    }
  }
}

const readWord = (buf, off) => ((buf[off] & 255) << 24) | ((buf[off + 1] & 255) << 16) | ((buf[off + 2] & 255) << 8) | (buf[off + 3] & 255);
const writeWord = (buf, off, v) => { buf[off] = (v >>> 24) & 255; buf[off + 1] = (v >>> 16) & 255; buf[off + 2] = (v >>> 8) & 255; buf[off + 3] = v & 255; };

// defpackage/f.java constructor (Nk=5 key schedule → 48 words, Nr=11)
function makeF(keyBytes) {
  const length = keyBytes.length / 4;
  const a = new Int32Array(length);
  for (let x = 0; x < length; x++) a[x] = readWord(keyBytes, x * 4);
  const b = length, rounds = length + 6, d = (length + 7) * 4;
  const e = new Int32Array(d);
  for (let i5 = 0; i5 < d; i5++) {
    let i2;
    if (i5 < b) i2 = a[i5];
    else {
      let i7 = e[i5 - 1];
      const i8 = i5 % b;
      if (i8 === 0) {
        const i9 = ((i7 >>> 24) | (i7 << 8)) >>> 0;
        i7 = (q[i5 / b] << 24) ^ (g[i9 & MASK] | ((g[(i9 >>> 24) & MASK] << 24) | (g[(i9 >>> 16) & MASK] << 16)) | (g[(i9 >>> 8) & MASK] << 8));
      } else if (b > 6 && i8 === 4) {
        i7 = (g[(i7 >>> 24) & MASK] << 24) | (g[(i7 >>> 16) & MASK] << 16) | (g[(i7 >>> 8) & MASK] << 8) | g[i7 & MASK];
      }
      i2 = e[i5 - b] ^ i7;
    }
    e[i5] = i2;
  }
  const fArr = new Int32Array(d);
  for (let i11 = 0; i11 < d; i11++) {
    const i12 = d - i11;
    const i13 = i11 % 4;
    let i14 = i13 !== 0 ? e[i12] : e[i12 - 4];
    if (i11 >= 4 && i12 > 4) {
      i14 = p[g[i14 & MASK]] ^ ((m[g[(i14 >>> 24) & MASK]] ^ n[g[(i14 >>> 16) & MASK]]) ^ o[g[(i14 >>> 8) & MASK]]);
    }
    fArr[i11] = i14;
  }
  return { rounds, f: fArr };
}

// One AES-Nk5 block (equivalent inverse cipher, ShiftRows word order 0/12/8/4)
function aesBlock(F, buf, off) {
  const iArr6 = F.f;
  let i21 = readWord(buf, off) ^ iArr6[0];
  let i22 = readWord(buf, off + 12) ^ iArr6[1];
  let i24 = readWord(buf, off + 8) ^ iArr6[2];
  let i25 = readWord(buf, off + 4) ^ iArr6[3];
  let i19 = 4;
  for (let r = 0; r < F.rounds - 1; r++) {
    const a1 = (n[(i22 >>> 16) & MASK] ^ m[(i21 >>> 24) & MASK] ^ o[(i24 >>> 8) & MASK] ^ p[i25 & MASK]) ^ iArr6[i19];
    const a2 = (m[(i22 >>> 24) & MASK] ^ n[(i24 >>> 16) & MASK] ^ o[(i25 >>> 8) & MASK] ^ p[i21 & MASK]) ^ iArr6[i19 + 1];
    const a3 = (n[(i25 >>> 16) & MASK] ^ m[(i24 >>> 24) & MASK] ^ o[(i21 >>> 8) & MASK] ^ p[i22 & MASK]) ^ iArr6[i19 + 2];
    const a4 = (m[(i25 >>> 24) & MASK] ^ n[(i21 >>> 16) & MASK] ^ o[(i22 >>> 8) & MASK] ^ p[i24 & MASK]) ^ iArr6[i19 + 3];
    i19 += 4;
    i21 = a1; i22 = a2; i24 = a3; i25 = a4;
  }
  const i31 = ((h[(i21 >>> 24) & MASK] << 24) | (h[(i22 >>> 16) & MASK] << 16) | (h[(i24 >>> 8) & MASK] << 8) | h[i25 & MASK]) ^ iArr6[i19];
  const i33 = ((h[(i24 >>> 16) & MASK] << 16) | (h[(i22 >>> 24) & MASK] << 24) | (h[i25 >>> 8 & MASK] << 8) | h[i21 & MASK]) ^ iArr6[i19 + 1];
  const i35 = ((h[(i25 >>> 16) & MASK] << 16) | (h[(i24 >>> 24) & MASK] << 24) | (h[i21 >>> 8 & MASK] << 8) | h[i22 & MASK]) ^ iArr6[i19 + 2];
  const i36 = ((h[(i25 >>> 24) & MASK] << 24) | (h[(i21 >>> 16) & MASK] << 16) | (h[(i22 >>> 8) & MASK] << 8) | h[i24 & MASK]) ^ iArr6[i19 + 3];
  writeWord(buf, off, i31);
  writeWord(buf, off + 12, i33);
  writeWord(buf, off + 8, i35);
  writeWord(buf, off + 4, i36);
}

// zlp.c — CBC, zero IV
function decrypt(ct, key) {
  const F = makeF(key);
  const out = Buffer.alloc(ct.length);
  let prev = Buffer.alloc(16); // zero IV
  for (let off = 0; off < ct.length; off += 16) {
    const block = Buffer.from(ct.subarray(off, off + 16));
    aesBlock(F, block, 0);
    for (let i = 0; i < 16; i++) out[off + i] = block[i] ^ prev[i];
    prev = Buffer.from(ct.subarray(off, off + 16));
  }
  return out;
}

const CIPHERTEXT = "970938944c92db9bf5e329905fb9ab6cca6fb29b80ea60a65aff9f8eb4a1c516";
const KEY = "QaUXkh4j7MHGgclj0oEW";
const secret = decrypt(Buffer.from(CIPHERTEXT, "hex"), Buffer.from(KEY, "utf8")).toString("latin1");
if (!/^[ -~]{16,64}$/.test(secret)) {
  console.error("decoded secret is not printable ASCII:", JSON.stringify(secret));
  process.exit(1);
}
console.log(secret);
