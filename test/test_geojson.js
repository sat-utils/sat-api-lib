'use strict';
process.env.ES_HOST = 'localhost:9200';

var nock = require('nock');
var test = require('tap').test;
var gjv = require('geojson-validation');
var Search = require('../index.js');
var payload = require('./events/geojson.json');


nock.back.fixtures = __dirname + '/fixtures';
nock.back.setMode('record');

var nockBack = function(key, func) {
  nock.back('geojson-' + key + '.json', function(nockDone) {
    var search = new Search(payload[key]);
    search.geojson(function (err, response) {
      nockDone();
      func(err, response);
    });
  });
};


test('geojson endpoint with simple GET/POST should return 1 result', function (t) {
  var keys = ['simpleGet', 'simplePost'];
  keys.forEach(function(key, index) {
    nockBack(key, function(err, response) {
      t.equals(response.properties.limit, 1);
      t.equals(response.features.length, 1);
      t.true(gjv.valid(response));
      if (index === keys.length - 1) {
        t.end();
      }
    });
  });
});

test('geojson endpoint with simple POST with limit 2 should return 2 result', function (t) {
  var key = 'simplePostLimit2';
  nockBack(key, function(err, response) {
    t.equals(response.properties.limit, 2);
    t.equals(response.features.length, 2);
    t.true(gjv.valid(response));
    t.end();
  });
});

test('geojson endpoint POST intersects', function (t) {
  var key = 'postIntersects';
  nockBack(key, function(err, response) {
    t.equals(response.properties.found, 237);
    t.equals(response.properties.limit, 1);
    t.equals(response.features.length, 1);
    t.true(gjv.valid(response));
    t.end();
  });
});

test('geojson endpoint GET intersects with no match', function (t) {
  var key = 'getIntersects';
  nockBack(key, function(err, response) {
    t.equals(response.properties.found, 0);
    t.equals(response.properties.limit, 1);
    t.equals(response.features.length, 0);
    t.true(gjv.valid(response));
    t.end();
  });
});

