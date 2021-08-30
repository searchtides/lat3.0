const parse = require("node-html-parser").parse;

let distribution_map = {};
const dmap = async function (html) {
  const root = parse(html);
  const rows = root
    .querySelectorAll("tr")
    .slice(2)
    .map((row) => {
      let cols = row.querySelectorAll("td");
      let country = cols[0].querySelector("div").text.trim();
      let part = cols[3].querySelector("span").text.trim();
      let percentage = Number(part.slice(0, -1));
      distribution_map[country] = percentage;
    });
  return distribution_map;
};

exports.dmap = dmap;
