import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";

const URL = "https://rekt.news/";

async function scrape() {
  const { data } = await axios.get(URL);
  const $ = cheerio.load(data);

  const articles: any[] = [];

  $("article").each((_, el) => {
    const title = $(el).find("h2").text().trim();
    const link = $(el).find("a").attr("href");

    if (link) {
      articles.push({ title, link });
    }
  });

  const dataDir = path.resolve(process.cwd(), "data", "raw");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  fs.writeFileSync(path.join(dataDir, "articles.json"), JSON.stringify(articles, null, 2));
  console.log("✅ Articles saved");
}

scrape();