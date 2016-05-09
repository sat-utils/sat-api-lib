process.env.ES_HOST = 'link-to-my-elasticsearh.com';

var express = require('express');
var api = require('../index.js');
var app = express();

app.get('/', function(req, res) {
  var search = new api(req);
  search.simple(function (err, resp) {
    res.send(resp);
  });
});

app.get('/count', function(req, res) {
  var search = new api(req);
  search.count(function (err, resp) {
    res.send(resp);
  });
});

app.get('/geojson', function(req, res) {
  var search = new api(req);
  search.geojson(function (err, resp) {
    res.send(resp);
  });
});

var port = process.env.PORT || 8000;
app.listen(port, function() {
  console.log('Listening on ' + port);
});
