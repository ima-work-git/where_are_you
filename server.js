const express = require('express');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, 'docs')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ローカルサーバー起動: http://localhost:${PORT}`);
  console.log(`指令台: http://localhost:${PORT}/`);
  console.log(`※ GitHub Pages用の静的ファイルを配信中 (docs/)`);
});
