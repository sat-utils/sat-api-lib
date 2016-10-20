'use strict';

var date = function (field) {
  return {
    scenes_by_date: {
      date_histogram: {
        format: 'YYYY-MM-dd',
        interval: 'day',
        field: field,
        order: { '_key': 'desc' }
      }
    }
  };
};

var term = function (field) {
  var aggs = {};

  aggs[`terms_${field}`] = {
    terms: {
      field: field
    }
  };

  return aggs;
};

module.exports.date = date;
module.exports.term = term;
