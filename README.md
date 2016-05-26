## sat-api-lib

[![npm version](https://badge.fury.io/js/sat-api-lib.svg)](http://badge.fury.io/js/sat-api-lib)
[![Build Status](https://travis-ci.org/sat-utils/sat-api-lib.svg?branch=master)](https://travis-ci.org/sat-utils/sat-api-lib)

We use this library for creating sat-api using API Gateway. You can use this API to build a standalone API in other frameworks such as Express

### Test

    $ npm install
    $ npm run test

### Express Example:

```js
process.env.ES_HOST = 'link-to-my-elasticsearh.com';

var express = require('express');
var api = require('sat-api-lib');
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
```

### About
Sat API Lib was made by [Development Seed](http://developmentseed.org).