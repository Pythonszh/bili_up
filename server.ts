import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  const db = new Database("bilibili.db");

  db.exec(`
    CREATE TABLE IF NOT EXISTS ups (
      uid TEXT PRIMARY KEY,
      name TEXT,
      face TEXT,
      sign TEXT,
      added_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS videos (
      bvid TEXT PRIMARY KEY,
      uid TEXT,
      title TEXT,
      pic TEXT,
      created INTEGER,
      length TEXT,
      play INTEGER,
      comment INTEGER,
      description TEXT,
      fetched_at INTEGER
    );
  `);

  // Bilibili Utilities
  const md5 = (str: string) => crypto.createHash("md5").update(str).digest("hex");

  const mixinKeyEncTab = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
    61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
    36, 20, 34, 44, 52
  ];

  const getMixinKey = (orig: string) => {
    let temp = "";
    mixinKeyEncTab.forEach((n) => {
      temp += orig[n];
    });
    return temp.slice(0, 32);
  };

  const encWbi = (params: any, img_key: string, sub_key: string) => {
    const mixin_key = getMixinKey(img_key + sub_key);
    const curr_time = Math.round(Date.now() / 1000);
    const chr_filter = /[!'()*]/g;

    Object.assign(params, { wts: curr_time });
    
    const query = Object.keys(params)
      .sort()
      .map((key) => {
        const value = params[key].toString().replace(chr_filter, "");
        return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
      })
      .join("&");

    const wbi_sign = md5(query + mixin_key);
    return query + "&w_rid=" + wbi_sign;
  };

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  };

  async function getWbiKeys() {
    const res = await fetch("https://api.bilibili.com/x/web-interface/nav", { headers });
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      if (!json.data || !json.data.wbi_img) {
        throw new Error(`Bilibili API error: ${json.message || 'Missing wbi_img'}`);
      }
      const img_url = json.data.wbi_img.img_url;
      const sub_url = json.data.wbi_img.sub_url;
      const img_key = img_url.substring(img_url.lastIndexOf("/") + 1, img_url.length).split(".")[0];
      const sub_key = sub_url.substring(sub_url.lastIndexOf("/") + 1, sub_url.length).split(".")[0];
      return { img_key, sub_key };
    } catch (e: any) {
      console.error("getWbiKeys error:", text.substring(0, 200));
      throw new Error("Failed to get Wbi keys: " + e.message);
    }
  }

  async function getBuvid() {
    const res = await fetch("https://api.bilibili.com/x/frontend/finger/spi", { headers });
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      if (json.code !== 0) throw new Error(`Bilibili API error: ${json.message}`);
      return {
        buvid3: json.data?.b_3 || "",
        buvid4: json.data?.b_4 || ""
      };
    } catch (e: any) {
      console.error("getBuvid error:", text.substring(0, 200));
      throw new Error("Failed to get buvid: " + e.message);
    }
  }

  async function getUserInfo(uid: string, img_key: string, sub_key: string, buvid3: string) {
    const params = { mid: uid };
    const query = encWbi(params, img_key, sub_key);
    const res = await fetch(`https://api.bilibili.com/x/space/wbi/acc/info?${query}`, {
      headers: {
        ...headers,
        "Cookie": `buvid3=${buvid3};`,
        "Origin": "https://space.bilibili.com",
        "Referer": `https://space.bilibili.com/${uid}/`
      }
    });
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      if (json.code === 0 && json.data) {
        return json.data;
      }
      return null;
    } catch (e) {
      console.error("getUserInfo error:", text.substring(0, 200));
      if (text.includes("<!DOCTYPE html>")) {
        throw new Error("Bilibili API blocked (WAF).");
      }
      throw new Error("Failed to parse user info response");
    }
  }

  async function searchUser(name: string, buvid3: string, img_key: string, sub_key: string) {
    const params = {
      search_type: "bili_user",
      keyword: name
    };
    const query = encWbi(params, img_key, sub_key);
    const res = await fetch(`https://api.bilibili.com/x/web-interface/wbi/search/type?${query}`, {
      headers: {
        ...headers,
        "Cookie": `buvid3=${buvid3};`,
        "Origin": "https://search.bilibili.com",
        "Referer": `https://search.bilibili.com/upuser?keyword=${encodeURIComponent(name)}`
      }
    });
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      if (json.code === 0 && json.data && json.data.result) {
        const users = Array.isArray(json.data.result) ? json.data.result : [];
        if (users.length > 0) return users[0];
      }
      return null;
    } catch (e) {
      console.error("searchUser error:", text.substring(0, 200));
      if (text.includes("<!DOCTYPE html>")) {
        throw new Error("Bilibili search API blocked (WAF). Please enter the UP's UID directly.");
      }
      throw new Error("Failed to parse search response");
    }
  }

  async function getUserVideos(uid: string, img_key: string, sub_key: string, buvid3: string) {
    const params = {
      mid: uid,
      ps: 10,
      tid: 0,
      pn: 1,
      keyword: "",
      order: "pubdate",
      platform: "web",
      web_location: 1550101,
      order_avoided: true
    };
    const query = encWbi(params, img_key, sub_key);
    const res = await fetch(`https://api.bilibili.com/x/space/wbi/arc/search?${query}`, {
      headers: {
        ...headers,
        "Cookie": `buvid3=${buvid3};`,
        "Origin": "https://space.bilibili.com",
        "Referer": `https://space.bilibili.com/${uid}/video`
      }
    });
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      if (json.code === 0 && json.data && json.data.list && json.data.list.vlist) {
        return json.data.list.vlist;
      }
      return [];
    } catch (e) {
      console.error("getUserVideos error:", text.substring(0, 200));
      return [];
    }
  }

  // API Routes
  app.post("/api/ups", async (req, res) => {
    const { name } = req.body;
    if (!name) {
      res.status(400).json({ error: "Name or UID is required" });
      return;
    }

    try {
      const { buvid3 } = await getBuvid();
      const { img_key, sub_key } = await getWbiKeys();
      
      let uid = "";
      let uname = "";
      let upic = "";
      let usign = "";

      if (/^\d+$/.test(name.trim())) {
        const userInfo = await getUserInfo(name.trim(), img_key, sub_key, buvid3);
        if (!userInfo) {
          res.status(404).json({ error: "User not found by UID" });
          return;
        }
        uid = name.trim();
        uname = userInfo.name;
        upic = userInfo.face;
        usign = userInfo.sign;
      } else {
        const user = await searchUser(name.trim(), buvid3, img_key, sub_key);
        if (!user) {
          res.status(404).json({ error: "User not found" });
          return;
        }
        uid = user.mid.toString();
        uname = user.uname.replace(/<[^>]*>?/gm, "");
        upic = user.upic;
        usign = user.usign;
      }

      const existing = db.prepare("SELECT * FROM ups WHERE uid = ?").get(uid);
      if (existing) {
        res.status(400).json({ error: "User already monitored" });
        return;
      }

      db.prepare("INSERT INTO ups (uid, name, face, sign, added_at) VALUES (?, ?, ?, ?, ?)").run(
        uid, uname, upic, usign, Date.now()
      );

      res.json({ success: true, user: { uid, name: uname, face: upic } });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/ups", (req, res) => {
    const ups = db.prepare("SELECT * FROM ups").all();
    res.json(ups);
  });

  app.post("/api/ups/batch", async (req, res) => {
    const { names } = req.body;
    if (!Array.isArray(names)) {
      res.status(400).json({ error: "Invalid data" });
      return;
    }

    const results = { success: [] as any[], failed: [] as any[] };
    try {
      const { buvid3 } = await getBuvid();
      const { img_key, sub_key } = await getWbiKeys();
      
      for (const name of names) {
        const input = name.trim();
        if (!input) continue;
        try {
          let uid = "";
          let uname = "";
          let upic = "";
          let usign = "";

          if (/^\d+$/.test(input)) {
            const userInfo = await getUserInfo(input, img_key, sub_key, buvid3);
            if (!userInfo) {
              results.failed.push({ name: input, reason: "Not found by UID" });
              continue;
            }
            uid = input;
            uname = userInfo.name;
            upic = userInfo.face;
            usign = userInfo.sign;
          } else {
            const user = await searchUser(input, buvid3, img_key, sub_key);
            if (!user) {
              results.failed.push({ name: input, reason: "Not found" });
              continue;
            }
            uid = user.mid.toString();
            uname = user.uname.replace(/<[^>]*>?/gm, "");
            upic = user.upic;
            usign = user.usign;
          }

          const existing = db.prepare("SELECT * FROM ups WHERE uid = ?").get(uid);
          if (existing) {
            results.failed.push({ name: uname || input, reason: "Already exists" });
            continue;
          }
          
          db.prepare("INSERT INTO ups (uid, name, face, sign, added_at) VALUES (?, ?, ?, ?, ?)").run(
            uid, uname, upic, usign, Date.now()
          );
          results.success.push({ name: uname, uid });
        } catch (err: any) {
          results.failed.push({ name: input, reason: err.message });
        }
        // Sleep to avoid rate limit
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/backup", (req, res) => {
    try {
      const ups = db.prepare("SELECT * FROM ups").all();
      res.json(ups);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/restore", async (req, res) => {
    const { ups } = req.body;
    if (!Array.isArray(ups)) {
      res.status(400).json({ error: "Invalid data" });
      return;
    }

    let count = 0;
    try {
      const insert = db.prepare("INSERT OR IGNORE INTO ups (uid, name, face, sign, added_at) VALUES (?, ?, ?, ?, ?)");
      const insertMany = db.transaction((upsList) => {
        for (const up of upsList) {
          if (up.uid && up.name) {
            const result = insert.run(up.uid, up.name, up.face || "", up.sign || "", up.added_at || Date.now());
            if (result.changes > 0) count++;
          }
        }
      });
      insertMany(ups);
      res.json({ success: true, count });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/ups/:uid", (req, res) => {
    try {
      db.prepare("DELETE FROM ups WHERE uid = ?").run(req.params.uid);
      db.prepare("DELETE FROM videos WHERE uid = ?").run(req.params.uid);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/videos", (req, res) => {
    const videos = db.prepare(`
      SELECT videos.*, ups.name as up_name, ups.face as up_face 
      FROM videos 
      JOIN ups ON videos.uid = ups.uid 
      ORDER BY created DESC
    `).all();
    res.json(videos);
  });

  app.post("/api/refresh", async (req, res) => {
    try {
      const ups = db.prepare("SELECT * FROM ups").all() as any[];
      if (ups.length === 0) {
        res.json({ success: true, count: 0 });
        return;
      }

      const { img_key, sub_key } = await getWbiKeys();
      const { buvid3 } = await getBuvid();

      let newVideosCount = 0;

      for (const up of ups) {
        const videos = await getUserVideos(up.uid, img_key, sub_key, buvid3);
        
        const insert = db.prepare(`
          INSERT OR IGNORE INTO videos (bvid, uid, title, pic, created, length, play, comment, description, fetched_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insertMany = db.transaction((vids) => {
          for (const v of vids) {
            const result = insert.run(v.bvid, up.uid, v.title, v.pic, v.created, v.length, v.play, v.comment, v.description, Date.now());
            if (result.changes > 0) newVideosCount++;
          }
        });

        insertMany(videos);
        
        // Sleep a bit to avoid rate limit
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      res.json({ success: true, count: newVideosCount });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
