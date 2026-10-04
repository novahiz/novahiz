// Test JavaScript file with XSS vulnerability
const express = require('express');
const app = express();

app.get('/search', (req, res) => {
  const query = req.query.q;
  
  // VULNERABLE: Direct innerHTML assignment
  const element = document.createElement('div');
  element.innerHTML = query;
  
  res.send('Search results');
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
