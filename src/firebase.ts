import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db =
  firebaseConfig.firestoreDatabaseId &&
  firebaseConfig.firestoreDatabaseId !== '(default)'
    ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
    : getFirestore(app);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

// Track current user in memory so even if iframe storage is restricted, popup sign-in works immediately
let activeUser: User | null = auth.currentUser;
let initialAuthResolved = false;
const authReadyPromise = new Promise<User | null>((resolve) => {
  const timeout = setTimeout(() => {
    if (!initialAuthResolved) {
      initialAuthResolved = true;
      resolve(activeUser || auth.currentUser);
    }
  }, 900);

  onAuthStateChanged(auth, (user) => {
    activeUser = user;
    if (!initialAuthResolved) {
      initialAuthResolved = true;
      clearTimeout(timeout);
      resolve(user);
    } else if (user) {
      // Automatically trigger game online bootstrap when user signs in
      setTimeout(() => {
        (window as any).__NETCO_AUTH_BOOT__?.();
      }, 50);
    }
    syncGoogleButtonVisibility();
  });
});

function getCurrentUser(): User | null {
  return activeUser || auth.currentUser;
}

function syncGoogleButtonVisibility() {
  const btn = document.getElementById('online-google');
  if (!btn) return;
  const signedIn = !!getCurrentUser();
  btn.hidden = signedIn;
}

// Cached baseline save document for diff/patch application
let cachedSaveDoc: Record<string, any> | null = null;
let cachedRevision = 0;
let cachedWalletSeq = 0;
let customPlayerName = '';

function sanitizeString(val: unknown, fallback: string, maxLen: number): string {
  const s = String(val ?? '').trim() || fallback;
  return s.slice(0, maxLen);
}

function sanitizeNumber(val: unknown, fallback: number, min?: number, max?: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  let res = n;
  if (min !== undefined && res < min) res = min;
  if (max !== undefined && res > max) res = max;
  return res;
}

async function decodeSaveRequestBody(
  body: any,
  headers: Record<string, string>
): Promise<any> {
  if (!body) return {};
  if (typeof body === 'string') {
    return JSON.parse(body);
  }
  let bytes: Uint8Array;
  if (body instanceof Uint8Array) {
    bytes = body;
  } else if (body instanceof ArrayBuffer) {
    bytes = new Uint8Array(body);
  } else if (body instanceof Blob) {
    bytes = new Uint8Array(await body.arrayBuffer());
  } else {
    return {};
  }

  const xPl = headers['x-pl'] || '';
  const contentType = headers['content-type'] || '';
  const netcoPayload = (globalThis as any).NetcoPayload;

  if (xPl && netcoPayload && typeof netcoPayload.unpack === 'function') {
    bytes = netcoPayload.unpack(bytes);
  }

  if (
    (xPl === 'gz' || contentType.includes('gzip')) &&
    typeof DecompressionStream !== 'undefined'
  ) {
    const decompressed = await new Response(
      new Blob([bytes as unknown as BlobPart])
        .stream()
        .pipeThrough(new DecompressionStream('gzip'))
    ).arrayBuffer();
    bytes = new Uint8Array(decompressed);
  }

  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text);
}

function extractShopMetadata(
  saveDoc: Record<string, any>,
  fallbackPlayerName: string
) {
  const netcoSave = (globalThis as any).NetcoSave;
  let flat: Record<string, any> = {};
  try {
    if (netcoSave && typeof netcoSave.decode === 'function') {
      flat = netcoSave.decode(saveDoc) || {};
    }
  } catch {
    flat = {};
  }

  const parts = saveDoc?.parts || {};
  const meta = parts.meta || parts.profile || flat || {};
  const prog = parts.progression?.progression || {};
  const econ = parts.economy || flat || {};

  const shopName = sanitizeString(
    flat.shopName || meta.shopName || 'Tiệm Nét Cỏ',
    'Tiệm Nét Cỏ',
    80
  );
  const playerName = sanitizeString(
    flat.playerName || meta.playerName || fallbackPlayerName || 'Ông Chủ',
    'Ông Chủ',
    80
  );
  const level = sanitizeNumber(prog.level ?? flat.level ?? 1, 1, 1, 200);
  const xpTotal = sanitizeNumber(prog.xpTotal ?? flat.xpTotal ?? 0, 0, 0);
  const day = sanitizeNumber(econ.day ?? flat.day ?? 1, 1, 1);
  const money = sanitizeNumber(econ.money ?? flat.money ?? 0, 0);
  const fame = sanitizeNumber(econ.fame ?? flat.fame ?? 0, 0);
  const decor = sanitizeNumber(flat.beauty ?? econ.beauty ?? 0, 0);

  // Extract visitable shop snapshot
  const stage = sanitizeNumber(flat.stage ?? meta.stage ?? 0, 0, 0, 10);
  const expansion = sanitizeNumber(flat.expansion ?? meta.expansion ?? 0, 0, 0, 10);
  const upgrades =
    flat.upgrades && typeof flat.upgrades === 'object' ? flat.upgrades : {};
  const rawPcs = Array.isArray(flat.pcs) ? flat.pcs : [];
  const pcs = rawPcs.slice(0, 60).map((pc: any) => ({
    num: sanitizeNumber(pc.num, 1, 1, 999),
    type: String(pc.type || 'basic'),
    x: sanitizeNumber(pc.x, 2, 0, 100),
    y: sanitizeNumber(pc.y, 4, 0, 100),
    chair: sanitizeNumber(pc.chair, 0, 0, 20),
    parts: pc.parts && typeof pc.parts === 'object' ? pc.parts : { cpu: 0, ram: 0, gpu: 0 },
  }));
  const rawDecor = Array.isArray(flat.decor) ? flat.decor : [];
  const decorList = rawDecor.slice(0, 80).map((d: any) => ({
    type: String(d.type || ''),
    x: sanitizeNumber(d.x, 1, 0, 100),
    y: sanitizeNumber(d.y, 1, 0, 100),
  }));

  const snapshot = {
    snapshotVersion: 2,
    shopName,
    level,
    stage,
    expansion,
    day,
    floorFinish: null,
    skin: null,
    upgrades,
    pcs,
    decor: decorList,
  };

  return {
    shopName,
    playerName,
    level,
    xpTotal,
    day,
    money,
    fame,
    decor,
    skinScore: 0,
    skinCount: 0,
    houseLevel: 0,
    snapshot,
  };
}

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      Date: new Date().toUTCString(),
    },
  });
}

async function handleApiRequest(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const cleanPath = path.replace(/^\/api\//, '');
  const [routePath] = cleanPath.split('?');
  const method = (init?.method || 'GET').toUpperCase();

  // Wait up to 900ms on initial bootstrap for persisted Firebase Auth state
  if (routePath === 'bootstrap' && !initialAuthResolved) {
    await authReadyPromise;
  }

  const user = getCurrentUser();

  const headersObj: Record<string, string> = {};
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((v, k) => {
        headersObj[k.toLowerCase()] = v;
      });
    } else if (Array.isArray(init.headers)) {
      for (const [k, v] of init.headers) {
        headersObj[k.toLowerCase()] = v;
      }
    } else {
      for (const [k, v] of Object.entries(init.headers)) {
        headersObj[k.toLowerCase()] = String(v);
      }
    }
  }

  // 1. Bootstrap / Auth Session
  if (routePath === 'bootstrap') {
    syncGoogleButtonVisibility();
    if (!user) {
      return jsonResponse(
        {
          code: 'AUTH_REQUIRED',
          error: 'Đăng nhập Google để mở quán mới',
          message: 'Đăng nhập Google để mở quán mới',
        },
        401
      );
    }
    return jsonResponse({
      user: {
        id: user.uid,
        name: customPlayerName || user.displayName || 'Ông Chủ',
        email: user.email || '',
        avatar: user.photoURL || '',
        titles: [],
        contestTitles: [],
      },
      serverTime: Date.now(),
      maxShopLevel: 60,
    });
  }

  // 2. Logout
  if (routePath === 'auth/logout') {
    activeUser = null;
    await signOut(auth);
    cachedSaveDoc = null;
    cachedRevision = 0;
    cachedWalletSeq = 0;
    syncGoogleButtonVisibility();
    return jsonResponse({ ok: true });
  }

  // 3. Play Session Release
  if (routePath === 'play/release') {
    return jsonResponse({ ok: true });
  }

  // Require authenticated user for remaining endpoints
  if (!user) {
    return jsonResponse(
      {
        code: 'AUTH_REQUIRED',
        error: 'Chưa đăng nhập Google.',
        message: 'Chưa đăng nhập Google.',
      },
      401
    );
  }

  // 4. Profile Update
  if (routePath === 'profile' && method === 'POST') {
    let bodyObj: any = {};
    try {
      bodyObj = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    } catch {
      bodyObj = {};
    }
    const newName = sanitizeString(
      bodyObj.name,
      user.displayName || 'Ông Chủ',
      80
    );
    customPlayerName = newName;
    return jsonResponse({ name: newName });
  }

  // 5. GET /api/save (Load Cloud Save from Firestore)
  if (routePath === 'save' && method === 'GET') {
    const savePath = `saves/${user.uid}`;
    try {
      const snap = await getDoc(doc(db, 'saves', user.uid));
      if (!snap.exists()) {
        cachedSaveDoc = null;
        cachedRevision = 0;
        cachedWalletSeq = 0;
        return jsonResponse({
          save: null,
          revision: 0,
          wallet_seq: 0,
          walletSeq: 0,
          last_client_save_at: 0,
          updated_at: 0,
          giftsPending: false,
          serverGifts: [],
          giftHistory: [],
          diamondGifts: [],
          diamondGiftHistory: [],
          rankingGifts: [],
          rankingGiftHistory: [],
          rankingGiftsPending: [],
          titles: [],
          eventTitles: [],
          maxShopLevel: 60,
        });
      }
      const data = snap.data();
      cachedSaveDoc = data.saveData || null;
      cachedRevision = sanitizeNumber(data.revision, 1, 0);
      cachedWalletSeq = sanitizeNumber(data.walletSeq, 0, 0);
      const updatedMs =
        data.updatedAt instanceof Timestamp
          ? data.updatedAt.toMillis()
          : Date.now();
      return jsonResponse({
        save: cachedSaveDoc,
        revision: cachedRevision,
        wallet_seq: cachedWalletSeq,
        walletSeq: cachedWalletSeq,
        last_client_save_at: updatedMs,
        updated_at: updatedMs,
        giftsPending: false,
        serverGifts: [],
        giftHistory: [],
        diamondGifts: [],
        diamondGiftHistory: [],
        rankingGifts: [],
        rankingGiftHistory: [],
        rankingGiftsPending: [],
        titles: [],
        eventTitles: [],
        maxShopLevel: 60,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, savePath);
    }
  }

  // 6. POST /api/save (Persist Cloud Save & Public Leaderboard Entry to Firestore)
  if (routePath === 'save' && method === 'POST') {
    const payload = await decodeSaveRequestBody(init?.body, headersObj);
    const netcoSave = (globalThis as any).NetcoSave;

    let nextSaveDoc: Record<string, any> | null = null;
    if (payload.snapshot && typeof payload.snapshot === 'object') {
      nextSaveDoc = payload.snapshot;
    } else if (payload.patch && cachedSaveDoc && netcoSave?.apply) {
      nextSaveDoc = netcoSave.apply(cachedSaveDoc, payload.patch);
    } else if ((window as any).__NETCO_LATEST_SAVE__) {
      nextSaveDoc = (window as any).__NETCO_LATEST_SAVE__;
    } else {
      nextSaveDoc = cachedSaveDoc || { format: 1, parts: {} };
    }

    cachedSaveDoc = nextSaveDoc;
    const nextRevision = sanitizeNumber(
      (payload.baseRevision ?? cachedRevision) + 1,
      1,
      0
    );
    const nextWalletSeq = sanitizeNumber(
      payload.walletSeq ?? cachedWalletSeq,
      0,
      0
    );
    cachedRevision = nextRevision;
    cachedWalletSeq = nextWalletSeq;

    const meta = extractShopMetadata(
      nextSaveDoc || {},
      customPlayerName || user.displayName || 'Ông Chủ'
    );

    const saveRef = doc(db, 'saves', user.uid);
    const shopRef = doc(db, 'shops', user.uid);

    try {
      const existingSave = await getDoc(saveRef);
      if (!existingSave.exists()) {
        await setDoc(saveRef, {
          uid: user.uid,
          shopName: meta.shopName,
          playerName: meta.playerName,
          revision: nextRevision,
          walletSeq: nextWalletSeq,
          level: meta.level,
          day: meta.day,
          saveData: nextSaveDoc || {},
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(saveRef, {
          shopName: meta.shopName,
          playerName: meta.playerName,
          revision: nextRevision,
          walletSeq: nextWalletSeq,
          level: meta.level,
          day: meta.day,
          saveData: nextSaveDoc || {},
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `saves/${user.uid}`);
    }

    try {
      const existingShop = await getDoc(shopRef);
      if (!existingShop.exists()) {
        await setDoc(shopRef, {
          uid: user.uid,
          shopName: meta.shopName,
          playerName: meta.playerName,
          level: meta.level,
          xpTotal: meta.xpTotal,
          day: meta.day,
          money: meta.money,
          fame: meta.fame,
          decor: meta.decor,
          likes: 0,
          skinScore: meta.skinScore,
          skinCount: meta.skinCount,
          houseLevel: meta.houseLevel,
          snapshot: meta.snapshot,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(shopRef, {
          shopName: meta.shopName,
          playerName: meta.playerName,
          level: meta.level,
          xpTotal: meta.xpTotal,
          day: meta.day,
          money: meta.money,
          fame: meta.fame,
          decor: meta.decor,
          skinScore: meta.skinScore,
          skinCount: meta.skinCount,
          houseLevel: meta.houseLevel,
          snapshot: meta.snapshot,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `shops/${user.uid}`);
    }

    const now = Date.now();
    return jsonResponse({
      ok: true,
      revision: nextRevision,
      wallet_seq: nextWalletSeq,
      walletSeq: nextWalletSeq,
      serverTime: now,
      updated_at: now,
      last_client_save_at: now,
      giftsPending: false,
      serverGifts: [],
      diamondGifts: [],
      rankingGifts: [],
      rankingGiftsPending: [],
    });
  }

  // 7. POST /api/save/reset (Delete Cloud Save)
  if (routePath === 'save/reset' && method === 'POST') {
    try {
      const saveRef = doc(db, 'saves', user.uid);
      const saveSnap = await getDoc(saveRef);
      if (saveSnap.exists()) {
        await deleteDoc(saveRef);
      }
      const shopRef = doc(db, 'shops', user.uid);
      const shopSnap = await getDoc(shopRef);
      if (shopSnap.exists()) {
        await deleteDoc(shopRef);
      }
      cachedSaveDoc = null;
      cachedRevision = 0;
      cachedWalletSeq = 0;
      return jsonResponse({
        ok: true,
        revision: 0,
        walletSeq: 0,
        wallet_seq: 0,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `saves/${user.uid}`);
    }
  }

  // 8. Wallet & Live Updates
  if (routePath === 'wallet' || routePath === 'updates') {
    return jsonResponse({
      events: [],
      wallet_seq: cachedWalletSeq,
      walletSeq: cachedWalletSeq,
      notices: [],
      serverTime: Date.now(),
    });
  }

  // 9. Leaderboards (/api/leaderboard)
  if (routePath === 'leaderboard') {
    try {
      const q = query(collection(db, 'shops'), limit(50));
      const snap = await getDocs(q);
      const allShops = snap.docs.map((d) => d.data());

      const buildBoard = (
        sortKey: string,
        mapRow: (item: any, rank: number) => any
      ) => {
        const sorted = [...allShops].sort(
          (a, b) => (Number(b[sortKey]) || 0) - (Number(a[sortKey]) || 0)
        );
        const rows = sorted.map((item, idx) => mapRow(item, idx + 1));
        const me = rows.find((r) => r.is_me) || null;
        return { rows, me };
      };

      const boards = {
        level: buildBoard('level', (s, rank) => ({
          rank,
          user_id: s.uid,
          shop_name: s.shopName,
          owner: s.playerName,
          level: s.level,
          xp_total: s.xpTotal || 0,
          is_me: s.uid === user.uid,
        })),
        assets: buildBoard('money', (s, rank) => ({
          rank,
          user_id: s.uid,
          shop_name: s.shopName,
          owner: s.playerName,
          assets: s.money || 0,
          shop_level: s.level,
          is_me: s.uid === user.uid,
        })),
        fame: buildBoard('fame', (s, rank) => ({
          rank,
          user_id: s.uid,
          shop_name: s.shopName,
          owner: s.playerName,
          fame: s.fame || 0,
          shop_level: s.level,
          is_me: s.uid === user.uid,
        })),
        decor: buildBoard('decor', (s, rank) => ({
          rank,
          user_id: s.uid,
          shop_name: s.shopName,
          owner: s.playerName,
          decor: s.decor || 0,
          shop_level: s.level,
          is_me: s.uid === user.uid,
        })),
        likes: buildBoard('likes', (s, rank) => ({
          rank,
          user_id: s.uid,
          shop_name: s.shopName,
          owner: s.playerName,
          likes: s.likes || 0,
          shop_level: s.level,
          is_me: s.uid === user.uid,
        })),
        skins: buildBoard('skinScore', (s, rank) => ({
          rank,
          user_id: s.uid,
          shop_name: s.shopName,
          owner: s.playerName,
          skin_score: s.skinScore || 0,
          skin_count: s.skinCount || 0,
          skin_level: 1,
          shop_level: s.level,
          is_me: s.uid === user.uid,
        })),
        house: buildBoard('houseLevel', (s, rank) => ({
          rank,
          user_id: s.uid,
          shop_name: s.shopName,
          owner: s.playerName,
          house: s.houseLevel || 0,
          house_tier: 1,
          shop_level: s.level,
          is_me: s.uid === user.uid,
        })),
      };

      return jsonResponse({
        boards,
        serverNow: Date.now(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'shops');
    }
  }

  // 10. Shop Visit Snapshot (/api/shops/{id}/snapshot)
  const shopSnapMatch = routePath.match(/^shops\/([^/]+)\/snapshot$/);
  if (shopSnapMatch) {
    const targetId = decodeURIComponent(shopSnapMatch[1]);
    try {
      const snap = await getDoc(doc(db, 'shops', targetId));
      if (!snap.exists()) {
        return jsonResponse(
          { code: 'NOT_FOUND', message: 'Không tìm thấy tiệm này.' },
          404
        );
      }
      const data = snap.data();
      const updatedMs =
        data.updatedAt instanceof Timestamp
          ? data.updatedAt.toMillis()
          : Date.now();
      return jsonResponse({
        meta: {
          accountId: data.uid,
          shopName: data.shopName,
          name: data.playerName,
          level: data.level,
          likes: data.likes || 0,
          liked: false,
          canLike: data.uid !== user.uid,
          updatedAt: updatedMs,
        },
        snapshot: data.snapshot || {
          snapshotVersion: 2,
          shopName: data.shopName,
          level: data.level,
          stage: 0,
          expansion: 0,
          day: data.day || 1,
          floorFinish: null,
          skin: null,
          upgrades: {},
          pcs: [],
          decor: [],
        },
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `shops/${targetId}`);
    }
  }

  // 11. Shop Like (/api/shops/like)
  if (routePath === 'shops/like' && method === 'POST') {
    let bodyObj: any = {};
    try {
      bodyObj = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    } catch {
      bodyObj = {};
    }
    const targetId = String(bodyObj.id || '').trim();
    if (!targetId || targetId === user.uid) {
      return jsonResponse({ likes: 0, liked: true });
    }
    try {
      const shopRef = doc(db, 'shops', targetId);
      const snap = await getDoc(shopRef);
      if (!snap.exists()) {
        return jsonResponse({ likes: 0, liked: false }, 404);
      }
      const nextLikes = (Number(snap.data().likes) || 0) + 1;
      await updateDoc(shopRef, {
        likes: nextLikes,
        updatedAt: serverTimestamp(),
      });
      return jsonResponse({ likes: nextLikes, liked: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `shops/${targetId}`);
    }
  }

  // 12. World Chat (/api/chat)
  if (routePath === 'chat' && method === 'GET') {
    try {
      const q = query(
        collection(db, 'chats'),
        orderBy('createdAt', 'desc'),
        limit(30)
      );
      const snap = await getDocs(q);
      const messages = snap.docs
        .map((d, idx) => {
          const data = d.data();
          const createdMs =
            data.createdAt instanceof Timestamp
              ? data.createdAt.toMillis()
              : Date.now();
          return {
            id: idx + 1,
            docId: d.id,
            account_id: data.uid,
            name: data.playerName,
            shopName: data.shopName,
            level: data.level,
            text: data.text,
            hearts: data.hearts || 0,
            created_at: createdMs,
          };
        })
        .reverse();
      return jsonResponse({
        messages,
        serverTime: Date.now(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'chats');
    }
  }

  if (routePath === 'chat' && method === 'POST') {
    let bodyObj: any = {};
    try {
      bodyObj = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    } catch {
      bodyObj = {};
    }
    const text = sanitizeString(bodyObj.text, '', 500);
    if (!text) {
      return jsonResponse({ messages: [], serverTime: Date.now() });
    }
    const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const meta = extractShopMetadata(
      cachedSaveDoc || {},
      customPlayerName || user.displayName || 'Ông Chủ'
    );
    try {
      await setDoc(doc(db, 'chats', msgId), {
        uid: user.uid,
        playerName: meta.playerName,
        shopName: meta.shopName,
        level: meta.level,
        text,
        hearts: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return handleApiRequest('/api/chat', { method: 'GET' });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `chats/${msgId}`);
    }
  }

  // 13. Gift Notices, Guilds, Loans, Contest Fallbacks
  if (routePath.startsWith('gifts/notice')) {
    return jsonResponse({ seen: true, now: Date.now() });
  }
  if (routePath === 'gifts/ack' || routePath === 'ranking-rewards/ack') {
    return jsonResponse({ ok: true });
  }
  if (routePath.startsWith('guild/')) {
    return jsonResponse({
      guild: null,
      rows: [],
      messages: [],
      serverTime: Date.now(),
    });
  }
  if (routePath.startsWith('loans')) {
    return jsonResponse({
      loans: [],
      quota: { used: 0, max: 3 },
      serverTime: Date.now(),
    });
  }
  if (routePath.startsWith('skin-drop')) {
    return jsonResponse({
      remaining: 0,
      mine: false,
      now: Date.now(),
    });
  }

  return jsonResponse({ ok: true, serverTime: Date.now() });
}

class FirebasePlaySocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState = FirebasePlaySocket.CONNECTING;
  onopen: ((ev: any) => void) | null = null;
  onmessage: ((ev: any) => void) | null = null;
  onclose: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    setTimeout(() => {
      if (this.readyState !== FirebasePlaySocket.CONNECTING) return;
      this.readyState = FirebasePlaySocket.OPEN;
      this.onopen?.({ type: 'open' });
      this.onmessage?.({ data: JSON.stringify({ state: 'active' }) });
    }, 15);
  }

  send(data: string) {
    if (this.readyState !== FirebasePlaySocket.OPEN) return;
    if (data === 'ping') {
      setTimeout(() => {
        if (this.readyState === FirebasePlaySocket.OPEN) {
          this.onmessage?.({ data: 'pong' });
        }
      }, 10);
    }
  }

  close() {
    this.readyState = FirebasePlaySocket.CLOSED;
    this.onclose?.({ type: 'close' });
  }
}

export function installFirebaseBridge(): void {
  const nativeFetch = window.fetch.bind(window);
  const patchedFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const urlStr =
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.href
        : input.url;

    try {
      const parsed = new URL(urlStr, window.location.origin);
      if (
        parsed.origin === window.location.origin &&
        parsed.pathname.startsWith('/api/')
      ) {
        return await handleApiRequest(
          parsed.pathname + parsed.search,
          init
        );
      }
    } catch {
      if (urlStr.startsWith('/api/')) {
        return await handleApiRequest(urlStr, init);
      }
    }

    return nativeFetch(input, init);
  };

  (window as any).__NETCO_FETCH__ = patchedFetch;
  try {
    Object.defineProperty(window, 'fetch', {
      value: patchedFetch,
      configurable: true,
      writable: true,
    });
  } catch {
    // window.fetch is non-configurable getter-only in this environment;
    // bundles call window.__NETCO_FETCH__ directly.
  }

  // Intercept WebSocket for /api/play/socket
  const NativeWebSocket = window.WebSocket;
  const PatchedWebSocket = function (
    this: any,
    url: string | URL,
    protocols?: string | string[]
  ) {
    const urlStr = String(url);
    if (
      urlStr.includes('/api/play/socket') ||
      urlStr.includes('/api/quiz/ws') ||
      urlStr.includes('/api/draw/ws')
    ) {
      return new FirebasePlaySocket(urlStr) as unknown as WebSocket;
    }
    return protocols !== undefined
      ? new NativeWebSocket(url, protocols)
      : new NativeWebSocket(url);
  } as unknown as typeof WebSocket;

  Object.defineProperties(PatchedWebSocket, {
    CONNECTING: { value: 0 },
    OPEN: { value: 1 },
    CLOSING: { value: 2 },
    CLOSED: { value: 3 },
  });
  PatchedWebSocket.prototype = NativeWebSocket.prototype;
  (window as any).__NETCO_WS__ = PatchedWebSocket;
  try {
    Object.defineProperty(window, 'WebSocket', {
      value: PatchedWebSocket,
      configurable: true,
      writable: true,
    });
  } catch {
    // window.WebSocket is non-configurable; bundles use window.__NETCO_WS__.
  }

  // Use document-level capture delegation so clicking #online-google ALWAYS opens Google Sign-In Popup
  document.addEventListener(
    'click',
    async (e) => {
      const target = e.target as Element | null;
      const btn = target?.closest?.('#online-google') as HTMLButtonElement | null;
      if (!btn) return;

      e.preventDefault();
      e.stopImmediatePropagation();

      const statusEl = document.getElementById('online-status');
      try {
        btn.disabled = true;
        if (statusEl) {
          statusEl.hidden = false;
          statusEl.textContent = 'Đang mở cửa sổ đăng nhập Google…';
        }
        const cred = await signInWithPopup(auth, googleProvider);
        activeUser = cred.user;
        btn.disabled = false;
        syncGoogleButtonVisibility();
        if (statusEl) {
          statusEl.textContent = 'Đang tải dữ liệu quán từ đám mây…';
        }
        if (typeof (window as any).__NETCO_AUTH_BOOT__ === 'function') {
          await (window as any).__NETCO_AUTH_BOOT__();
        } else {
          window.location.reload();
        }
      } catch (err: any) {
        btn.disabled = false;
        syncGoogleButtonVisibility();
        if (statusEl) {
          statusEl.hidden = false;
          statusEl.textContent =
            err?.code === 'auth/popup-closed-by-user'
              ? 'Đã đóng cửa sổ đăng nhập Google. Bấm ĐĂNG NHẬP GOOGLE để thử lại.'
              : 'Đăng nhập Google thất bại: ' + (err?.message || 'Lỗi kết nối');
        }
      }
    },
    true
  );

  // Ensure #online-google stays visible whenever user is not signed in
  const btn = document.getElementById('online-google');
  if (btn) {
    new MutationObserver(() => {
      if (!getCurrentUser() && btn.hidden) {
        btn.hidden = false;
      }
    }).observe(btn, { attributes: true, attributeFilter: ['hidden'] });
  }
  syncGoogleButtonVisibility();
}
