/**
 * members.js — /api/members/* routes
 * Port of backend/routes/user_routes.py
 *
 * Member image uploads are stored in the daemon-compatible media path.
 * Face processing (embedding generation) is intentionally left to the
 * existing Python backend — face images are simply saved to disk here.
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execSync } = require('child_process');

function detectPythonBin() {
  // Try each candidate and check if cv2 is importable in that environment
  const candidates = ["python", "py", "python3"];
  for (const bin of candidates) {
    try {
      execSync(`${bin} --version`, { stdio: "ignore", timeout: 3000, windowsHide: true });
      try {
        execSync(`${bin} -c "import cv2"`, { stdio: "ignore", timeout: 5000, windowsHide: true });
        console.log(`[INFO] Python with cv2 found: ${bin}`);
        return bin;
      } catch {
        console.warn(`[WARN] ${bin} exists but cv2 not importable in that environment`);
      }
    } catch { }
  }
  // Try absolute path from where command
  try {
    const fullPath = execSync("where python", {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
      windowsHide: true,
    }).toString().split("\r\n")[0].trim();
    if (fullPath.endsWith(".exe") && fs.existsSync(fullPath)) {
      console.log(`[INFO] Using absolute Python path: ${fullPath}`);
      return `"${fullPath}"`;
    }
  } catch { }
  console.error("[FATAL] No Python binary with cv2 found. Run: python -m pip install opencv-python");
  return "python";
}

const PYTHON_BIN = process.env.PYTHON_BIN || detectPythonBin();
const PYTHON_SCRIPT = process.env.PYTHON_SCRIPT ||
  path.join(__dirname, "../python/process_face.py").replace(/\\/g, "/");

if (!require("fs").existsSync(PYTHON_SCRIPT.replace(/\//g, "\\"))) {
  console.error(`[FATAL] Python script not found at: ${PYTHON_SCRIPT}`);
}

const { requireAuth } = require('../middlewares/auth');
const { getOrgFromClaims, getIdColumn } = require('../middlewares/auth');
const daemonDb = require('../services/daemonDb');
const { getImagePath, getIdColumn: getIdCol } = require('../utils/tableNames');

const MEDIA_ROOT = process.env.MEDIA_ROOT
  ? path.resolve(__dirname, '..', process.env.MEDIA_ROOT)
  : path.resolve(__dirname, '../../../../daemon/media');

function getOrg(req) {
  const c = req.jwtClaims || {};
  return { orgId: c.org_id ?? null, orgName: c.org_name ?? null, mode: c.mode ?? false };
}

function memberToDict(member, mode) {
  const idCol = getIdCol(mode);
  const personId = member[idCol];
  return {
    person_id: personId,
    id_type: mode ? 'employee_id' : 'member_id',
    member_id: member.member_id,
    employee_id: member.employee_id,
    name: member.name,
    phone_number: member.phone_number,
    imagepath: member.imagepath,
    vault_number: member.vault_number,
    checkin_timestamp: member.checkin_timestamp ? String(member.checkin_timestamp) : null,
    checkout_timestamp: member.checkout_timestamp ? String(member.checkout_timestamp) : null,
    recent_update: member.recent_update,
  };
}

// GET /api/members
router.get('/', requireAuth, async (req, res) => {
  const { orgId, orgName, mode } = getOrg(req);
  if (!orgId || !orgName) return res.status(400).json({ message: 'Missing organisation in token' });
  try {
    const members = await daemonDb.listMembers(orgName, orgId, false, mode);
    return res.json(members.map(m => memberToDict(m, mode)));
  } catch (err) {
    console.error(`[LIST_MEMBERS_ERROR] org=${orgName}_${orgId}:`, err.message);
    return res.status(500).json({ message: `Error listing members: ${err.message}` });
  }
});

// GET /api/members/next-id
router.get('/next-id', requireAuth, async (req, res) => {
  const { orgId, orgName, mode } = getOrg(req);
  if (!orgId || !orgName) return res.status(400).json({ message: 'Missing organisation in token' });
  try {
    const nextId = await daemonDb.getNextId(orgName, orgId, mode);
    return res.json({ next_id: nextId, id_type: mode ? 'employee_id' : 'member_id' });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// GET /api/members/pending-sync
router.get('/pending-sync', requireAuth, async (req, res) => {
  const { orgId, orgName, mode } = getOrg(req);
  if (!orgId || !orgName) return res.status(400).json({ message: 'Missing organisation in token' });
  try {
    const pending = await daemonDb.getPendingSync(orgName, orgId, mode);
    return res.json({ pending: pending.map(m => memberToDict(m, mode)), count: pending.length });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// GET /api/members/logs
router.get('/logs', requireAuth, async (req, res) => {
  const { orgId, orgName } = getOrg(req);
  if (!orgId || !orgName) return res.status(400).json({ message: 'Missing organisation in token' });
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const perPage = Math.min(parseInt(req.query.per_page || '50', 10), 100);
  const offset = (page - 1) * perPage;
  try {
    const logs = await daemonDb.fetchLogs(orgName, orgId, perPage, offset);
    logs.forEach(log => {
      ['checkin_timestamp', 'checkout_timestamp'].forEach(k => {
        if (log[k]) log[k] = String(log[k]);
      });
    });
    return res.json({ logs, page, per_page: perPage });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// POST /api/members
router.post('/', requireAuth, async (req, res) => {
  const { orgId, orgName, mode } = getOrg(req);
  if (!orgId || !orgName) return res.status(400).json({ message: 'Missing organisation in token' });

  const { name = '', phone_number = '', person_id } = req.body || {};
  if (!name.trim()) return res.status(400).json({ message: 'name is required' });

  try {
    let personId;
    if (person_id !== undefined && person_id !== null && person_id !== '') {
      personId = parseInt(person_id, 10);
      if (!personId || personId <= 0) return res.status(400).json({ message: 'person_id must be a positive integer' });
      const existing = await daemonDb.getMember(orgName, orgId, mode, personId);
      if (existing) return res.status(409).json({ message: `ID ${personId} is already taken` });
    } else {
      personId = await daemonDb.getNextId(orgName, orgId, mode);
    }

    const relPath = getImagePath(orgName, orgId, personId);
    const member = await daemonDb.addMember(orgName, orgId, mode, personId, name.trim(), phone_number.trim() || null, relPath);
    return res.status(201).json(memberToDict(member, mode));
  } catch (err) {
    console.error(`[MEMBER_CREATE_ERROR] org=${orgName}_${orgId}:`, err.message);
    return res.status(500).json({ message: `Error creating member: ${err.message}` });
  }
});

// PUT /api/members/:id
router.put('/:id', requireAuth, async (req, res) => {
  const { orgId, orgName, mode } = getOrg(req);
  if (!orgId || !orgName) return res.status(400).json({ message: 'Missing organisation in token' });
  const personId = parseInt(req.params.id, 10);
  const { name, phone_number } = req.body || {};
  try {
    const member = await daemonDb.updateMember(orgName, orgId, mode, personId, {
      name: name !== undefined ? name.trim() : undefined,
      phoneNumber: phone_number !== undefined ? phone_number.trim() : undefined,
    });
    if (!member) return res.status(404).json({ message: 'Member not found' });
    return res.json(memberToDict(member, mode));
  } catch (err) {
    return res.status(500).json({ message: `Error updating member: ${err.message}` });
  }
});

// DELETE /api/members/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const { orgId, orgName, mode } = getOrg(req);
  if (!orgId || !orgName) return res.status(400).json({ message: 'Missing organisation in token' });
  const personId = parseInt(req.params.id, 10);
  try {
    const member = await daemonDb.getMember(orgName, orgId, mode, personId);
    if (!member) return res.status(404).json({ message: 'Member not found' });

    const success = await daemonDb.deleteMember(orgName, orgId, mode, personId);
    if (!success) return res.status(404).json({ message: 'Member not found' });

    // Delete image folder from disk
    const relPath = member.imagepath || getImagePath(orgName, orgId, personId);
    const imgFolder = path.join(MEDIA_ROOT, relPath);
    if (fs.existsSync(imgFolder) && fs.statSync(imgFolder).isDirectory()) {
      fs.rmSync(imgFolder, { recursive: true, force: true });
    }

    return res.json({ message: 'Member marked for deletion', person_id: personId, recent_update: 'D' });
  } catch (err) {
    return res.status(500).json({ message: `Error deleting member: ${err.message}` });
  }
});

// POST /api/members/:id/validate-frame
router.post('/:id/validate-frame', requireAuth, async (req, res) => {
  const { orgId, orgName } = getOrg(req);
  if (!orgId || !orgName) return res.status(400).json({ message: 'Missing organisation in token' });
  const { image, step, prev_cx } = req.body || {};
  if (!image || !step) return res.status(400).json({ message: 'image and step are required' });

  // Fix F: Binary base64 writes
  const base64Clean = (image || "").replace(/^data:image\/\w+;base64,/, "");
  if (!base64Clean || base64Clean.length < 500) {
    return res.status(400).json({ valid: false, reason: "Empty or invalid image data" });
  }
  const buffer = Buffer.from(base64Clean, "base64");
  if (buffer.length < 1000) {
    return res.status(400).json({ valid: false, reason: "Image buffer too small — likely corrupt" });
  }

  const tmpFile = path.join(os.tmpdir(), `face_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
  try {
    fs.writeFileSync(tmpFile, buffer);

    const runPython = () => new Promise((resolve, reject) => {
      let chunks = [];
      let errChunks = [];
      const args = [
        PYTHON_SCRIPT,
        '--mode', 'validate',
        '--input', tmpFile,
        '--step', step,
        '--prev_cx', prev_cx !== undefined && prev_cx !== null ? String(prev_cx) : 'null'
      ];

      // Fix E: spawn options
      const py = spawn(PYTHON_BIN, args, {
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: "1",
          PYTHONIOENCODING: "utf-8",
          TF_CPP_MIN_LOG_LEVEL: "3",
          TF_ENABLE_ONEDNN_OPTS: "0",
          CUDA_VISIBLE_DEVICES: "-1",
        }
      });

      const timeout = setTimeout(() => {
        py.kill();
        reject(new Error('Timeout'));
      }, 60000);

      py.stdout.on('data', data => chunks.push(data));
      py.stderr.on('data', data => errChunks.push(data));

      py.on('close', (code) => {
        clearTimeout(timeout);

        const stdout = Buffer.concat(chunks).toString("utf8").trim();
        const stderr = Buffer.concat(errChunks).toString("utf8").trim();

        if (stderr) {
          const stderrLines = stderr.split("\n").filter(l =>
            l.includes("Error") || l.includes("Traceback") || l.includes("Exception")
          );
          if (stderrLines.length) console.error("[Python error]:", stderrLines.join("\n"));
        }

        // Fix B2: robust JSON parsing
        const jsonMatches = [...stdout.matchAll(/(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})/g)];
        const lastJson = jsonMatches.length ? jsonMatches[jsonMatches.length - 1][1] : null;

        if (!lastJson) {
          console.error("[Python stdout raw]:", JSON.stringify(stdout.substring(0, 300)));
          return resolve({ valid: false, reason: 'Invalid response from validation script' });
        }

        try {
          resolve(JSON.parse(lastJson));
        } catch (e) {
          console.error(`JSON parse failed: ${e.message}. Raw: ${lastJson.substring(0, 200)}`);
          resolve({ valid: false, reason: 'Invalid response from validation script' });
        }
      });

      py.on('error', (err) => {
        clearTimeout(timeout);
        resolve({ valid: false, reason: 'Failed to run validation script' });
      });
    });

    const result = await runPython();
    res.json(result);
  } catch (err) {
    if (err.message === 'Timeout') {
      res.json({ valid: false, reason: 'Server error: validation timeout' });
    } else {
      res.json({ valid: false, reason: 'Server error' });
    }
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

// POST /api/members/:id/images
router.post('/:id/images', requireAuth, async (req, res) => {
  const { orgId, orgName, mode: userMode } = getOrg(req);
  if (!orgId || !orgName) return res.status(400).json({ message: 'Missing organisation in token' });
  const personId = parseInt(req.params.id, 10);

  const member = await daemonDb.getMember(orgName, orgId, userMode, personId);
  if (!member) return res.status(404).json({ message: 'Member not found' });

  const { mode, images = [] } = req.body || {};
  if (mode !== 'camera' && mode !== 'upload') {
    return res.status(400).json({ message: 'mode must be camera or upload' });
  }

  if (mode === 'camera' && images.length !== 3) {
    return res.status(400).json({ message: 'camera mode requires exactly 3 images' });
  }
  if (mode === 'upload' && images.length !== 1) {
    return res.status(400).json({ message: 'upload mode requires exactly 1 image' });
  }

  const tmpFiles = [];
  try {
    const embeddingsDir = process.env.EMBEDDINGS_DIR || path.join(__dirname, '../../data/embeddings');

    let spawnArgs = [];
    if (mode === 'camera') {
      const jobFile = path.join(os.tmpdir(), `job-${Date.now()}-${Math.floor(Math.random() * 10000)}.json`);
      fs.writeFileSync(jobFile, JSON.stringify(images));
      tmpFiles.push(jobFile);
      spawnArgs = [PYTHON_SCRIPT, '--mode', 'camera', '--input', jobFile, '--member_id', String(personId), '--output_dir', embeddingsDir];
    } else {
      const imgFile = path.join(os.tmpdir(), `upload-${Date.now()}-${Math.floor(Math.random() * 10000)}.jpg`);
      const b64 = images[0].base64 || images[0].dataUrl;
      const base64Clean = (b64 || '').replace(/^data:image\/\w+;base64,/, "");
      fs.writeFileSync(imgFile, Buffer.from(base64Clean, "base64"));
      tmpFiles.push(imgFile);
      spawnArgs = [PYTHON_SCRIPT, '--mode', 'upload', '--input', imgFile, '--member_id', String(personId), '--output_dir', embeddingsDir];
    }

    const runPython = () => new Promise((resolve, reject) => {
      let chunks = [];
      let errChunks = [];
      const py = spawn(PYTHON_BIN, spawnArgs, {
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: "1",
          PYTHONIOENCODING: "utf-8",
          TF_CPP_MIN_LOG_LEVEL: "3",
          TF_ENABLE_ONEDNN_OPTS: "0",
          CUDA_VISIBLE_DEVICES: "-1",
        }
      });

      const timeout = setTimeout(() => {
        py.kill();
        reject(new Error('Python script timed out'));
      }, mode === 'camera' ? 60000 : 30000);

      py.stdout.on('data', data => chunks.push(data));
      py.stderr.on('data', data => errChunks.push(data));

      py.on('close', code => {
        clearTimeout(timeout);
        const stdout = Buffer.concat(chunks).toString("utf8").trim();
        const stderr = Buffer.concat(errChunks).toString("utf8").trim();

        if (stderr) {
          const stderrLines = stderr.split("\n").filter(l =>
            l.includes("Error") || l.includes("Traceback") || l.includes("Exception")
          );
          if (stderrLines.length) console.error("[Python error]:", stderrLines.join("\n"));
        }

        const jsonMatches = [...stdout.matchAll(/(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})/g)];
        const lastJson = jsonMatches.length ? jsonMatches[jsonMatches.length - 1][1] : null;

        if (!lastJson) {
          return reject(new Error(
            `Python returned no JSON. Exit code: ${code}. Stdout: ${stdout.substring(0, 150)}. Stderr: ${stderr.substring(0, 150)}`
          ));
        }

        try {
          const result = JSON.parse(lastJson);
          if (result.success) {
            resolve(result);
          } else {
            reject(new Error(result.error || 'Unknown python error'));
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${e.message}`));
        }
      });
      py.on('error', err => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    const result = await runPython();
    return res.status(200).json({ success: true, path: result.path, count: result.count });
  } catch (err) {
    return res.status(422).json({ success: false, error: err.message });
  } finally {
    for (const f of tmpFiles) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  }
});

// GET /api/members/:id/images
router.get('/:id/images', requireAuth, async (req, res) => {
  const { orgId, orgName, mode } = getOrg(req);
  if (!orgId || !orgName) return res.status(400).json({ message: 'Missing organisation in token' });
  const personId = parseInt(req.params.id, 10);

  const member = await daemonDb.getMember(orgName, orgId, mode, personId);
  const relPath = (member && member.imagepath) || getImagePath(orgName, orgId, personId);
  const folder = path.join(MEDIA_ROOT, relPath);

  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    return res.json({ images: [], face_metrics: null });
  }

  const preview = `${personId}-1.jpg`;
  const filenames = fs.existsSync(path.join(folder, preview)) ? [preview] : [];

  return res.json({ images: filenames, face_metrics: null });
});

// GET /api/members/:id/images/:filename — serve image file
router.get('/:id/images/:filename', requireAuth, async (req, res) => {
  const { orgId, orgName, mode } = getOrg(req);
  if (!orgId || !orgName) return res.status(400).json({ message: 'Missing organisation in token' });
  const personId = parseInt(req.params.id, 10);
  const { filename } = req.params;

  const member = await daemonDb.getMember(orgName, orgId, mode, personId);
  const relPath = (member && member.imagepath) || getImagePath(orgName, orgId, personId);
  const folder = path.join(MEDIA_ROOT, relPath);

  if (!fs.existsSync(folder)) return res.status(404).json({ message: 'Not found' });

  const filePath = path.join(folder, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'Image not found' });

  return res.sendFile(filePath);
});

module.exports = router;
