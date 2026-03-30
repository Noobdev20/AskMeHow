import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";

const articles = JSON.parse(
  fs.readFileSync("./data/raw/articles.json", "utf-8")
);

async function fetchArticles() {
  const results: any[] = [];

  for (const article of articles.slice(0, 10)) { // limit for testing
    const { data } = await axios.get(article.link);
    const $ = cheerio.load(data);

    const text = $("article").text().trim();

    results.push({
      title: article.title,
      link: article.link,
      content: text
    });

    console.log("Fetched:", article.title);
  }

  fs.writeFileSync("./data/raw/content.json", JSON.stringify(results, null, 2));
}

fetchArticles();