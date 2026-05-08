fetch('https://highlightly.net/cricket-api/documentation/')
  .then(res => res.text())
  .then(text => {
    const match = text.match(/https?:\/\/[^\s"']+\.json/g);
    console.log("JSON Links found:", match);
  });
