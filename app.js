
/**
 * Module dependencies.
 */

var express = require('express')
  , routes = require('./routes')
  , uploads = require('./routes/uploads')
  , http = require('http')
  , path = require('path')
  , stylus = require('stylus');

var app = express();

// all environments
app.set('port', process.env.PORT || 3000);
app.set('views', __dirname + '/views');
app.set('view engine', 'jade');
app.use(express.logger('dev'));
app.use(express.compress());
app.use(express.favicon());
app.use(express.methodOverride());
app.use(app.router);
app.use(stylus.middleware(__dirname + '/public'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.errorHandler());

app.get('/', routes.index);
app.post('/upload', uploads.upload);
app.get('/uploads/data/*', uploads.data);
app.get('/uploads/export/*', uploads.export);
app.get('/uploads/*', uploads.index);

http.createServer(app).listen(app.get('port'), function(){
  console.log('Express server listening on port ' + app.get('port'));
});
