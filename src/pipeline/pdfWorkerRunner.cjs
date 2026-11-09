const fs = require('fs');
const pdfParse = require('pdf-parse');

async function main() {
  const chunks = [];
  process.stdin.on('data', (chunk) => chunks.push(chunk));
  process.stdin.on('end', async () => {
    try {
      const buffer = Buffer.concat(chunks);
      if (buffer.length === 0) {
        process.stdout.write(JSON.stringify({ items: [], numpages: 0 }));
        return;
      }

      let items = [];
      const result = await pdfParse(buffer, {
        pagerender: (pageData) =>
          pageData.getTextContent().then((tc) => {
            const pageItems = tc.items
              .map((it) => ({
                str: it.str.trim(),
                raw: it.str,
                x: it.transform[4],
                y: it.transform[5],
                w: it.width,
                h: it.height,
              }))
              .filter((it) => it.str.length > 0);
            items.push(...pageItems);
            return '';
          }),
      });

      process.stdout.write(
        JSON.stringify({
          items,
          numpages: result.numpages || 1,
        })
      );
    } catch (err) {
      process.stderr.write((err && err.message) || String(err));
      process.exit(1);
    }
  });
}

main();
