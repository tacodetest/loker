// Jalankan dari root proyek (E:\WEB PRIBADI\web_loker): node inspect-debug.mjs
import { existsSync, readFileSync } from "node:fs";

const read = (name) => (existsSync(`debug/${name}`) ? readFileSync(`debug/${name}`, "utf8") : null);
const short = (v) =>
  typeof v === "string"
    ? `[${v.length} karakter] ${v.slice(0, 90).replace(/\s+/g, " ")}`
    : String(JSON.stringify(v)).slice(0, 90);

function nextData(html) {
  const m = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  try {
    return m ? JSON.parse(m[1]) : null;
  } catch {
    return null;
  }
}

function walk(value, path, visit, depth = 0) {
  if (depth > 25 || value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = Array.isArray(value) ? `${path}[]` : `${path}.${key}`;
    visit(childPath, child);
    walk(child, childPath, visit, depth + 1);
  }
}

// ---------- Glints detail ----------
const glintsDetail = read("glints-detail.html");
if (glintsDetail) {
  console.log("\n=== GLINTS DETAIL: JSON-LD ===");
  for (const m of glintsDetail.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      for (const item of [].concat(JSON.parse(m[1]))) {
        console.log("@type:", item["@type"], "| keys:", Object.keys(item).join(", "));
        if (item["@type"] === "JobPosting") {
          console.log("  title      :", short(item.title));
          console.log("  description:", short(item.description));
          console.log("  baseSalary :", short(item.baseSalary));
          console.log("  datePosted :", short(item.datePosted));
        }
      }
    } catch {
      console.log("(JSON-LD tidak bisa di-parse)");
    }
  }
  console.log("\n=== GLINTS DETAIL: __NEXT_DATA__ ===");
  const data = nextData(glintsDetail);
  const seen = new Set();
  if (data) {
    walk(data, "$", (path, value) => {
      if (/desc|title|company|salary|location|employ|jobtype|created|updated/i.test(path) && !seen.has(path) && seen.size < 80) {
        seen.add(path);
        console.log(path, "=>", short(value));
      }
    });
  } else {
    console.log("(tidak ada / tidak bisa di-parse)");
  }
}

// ---------- Glints listing ----------
const glintsListing = read("glints-listing.html");
if (glintsListing) {
  console.log("\n=== GLINTS LISTING ===");
  console.log("jumlah link 'Job card title:':", (glintsListing.match(/aria-label="Job card title:/g) || []).length);
  const data = nextData(glintsListing);
  if (data) {
    walk(data, "$", (path, value) => {
      if (Array.isArray(value) && value.length >= 5 && value[0] && typeof value[0] === "object") {
        console.log(path, "-> array", value.length, "item; key item pertama:", Object.keys(value[0]).slice(0, 12).join(", "));
      }
    });
  }
}

// ---------- JobStreet ----------
for (const kind of ["listing", "detail"]) {
  const html = read(`jobstreet-${kind}.html`);
  if (!html) continue;
  console.log(`\n=== JOBSTREET ${kind.toUpperCase()} ===`);
  console.log("<title>:", html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim().slice(0, 120), "| ukuran:", html.length);
  const marks =
    kind === "listing"
      ? ['data-testid="job-card-title"', "SEEK_REDUX_DATA", "SEEK_APP_DATA", "listedAt", "captcha"]
      : [
          'data-automation="job-detail-title"',
          'data-automation="advertiser-name"',
          'data-automation="job-detail-location"',
          'data-automation="job-detail-work-type"',
          'data-automation="jobAdDetails"',
          "Diposting",
          "SEEK_REDUX_DATA",
          "SEEK_APP_DATA",
          "listedAt",
          "captcha",
        ];
  for (const mark of marks) console.log(mark.padEnd(45), html.includes(mark) ? "ADA" : "tidak ada");
  if (kind === "detail") console.log("teks 'Diposting':", html.match(/Diposting[^<]{0,40}/)?.[0] ?? "(tidak ketemu)");
}
