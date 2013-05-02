

function loadData() {
	var pathArray = window.location.pathname.split( '/' );
    var file_id = pathArray[pathArray.length -1];
	var jqxhr = $.getJSON( '/data/' + file_id, function(data) {
		document.data = data;
		updateMaps();
		updateElevationChart();
		document.getElementById('loading');
		loading.style.display = 'none';
	})
	.done(function() { console.log( "loadData() completed successfully" ); })
	.fail(function(error) { console.log( "loadData() failed: " + error); })
	.always(function() { console.log( "Finished loadData()" ); });
}

function updateElevationChart() {
		var data = document.data;
		
		var chartData = [['Distance', 'Uploaded Elevation', 'Google Elevation']];
		for (var i = 0; i < data.uploadElevation.length; i++) {
		    var googleElevation = data.googleElevation[i];
		    if (!googleElevation) {
		    	googleElevation = 0;
		    }
			chartData[i + 1] = [data.distance[i], data.uploadElevation[i], googleElevation];
		}
		
        var dataTable = google.visualization.arrayToDataTable(chartData);

        var options = {
          title : 'Elevation',
          hAxis: { title: 'Distance (km)'},
          vAxis: { title: 'Elevation (m)'}
        }

        var chart = new google.visualization.LineChart(document.getElementById('elevation-canvas'));
        chart.draw(dataTable, options);
}

function updateMaps() {
	var data = document.data;
	
	if (!data || data.latitude.length == 0) {
		console.error("Cannot load map with no data.");
		return;
	}
	
	if (data.latitude.length !== data.longitude.length) {
		console.error("Data is corrupt, cannot load map.");
		return;
	}

    var middle = data.latitude.length / 2;
  	var myLatLng = new google.maps.LatLng(data.latitude[middle], data.longitude[middle]);
  	var mapOptions = {
    	zoom: 10,
    	center: myLatLng,
    	mapTypeId: google.maps.MapTypeId.TERRAIN
 	 };

  	var map = new google.maps.Map(document.getElementById('map-canvas'), mapOptions);

  	var coordinates = [];
  	
  	for (var i = 0; i < data.latitude.length;i++) {
  		coordinates[i] = new google.maps.LatLng(data.latitude[i], data.longitude[i]);
  	}  	
  	
	var route = new google.maps.Polyline({
	    path: coordinates,
	    strokeColor: '#FF0000',
	    strokeOpacity: 1.0,
	    strokeWeight: 2
	  });

    route.setMap(map);
}

google.maps.event.addDomListener(window, 'load', loadData);
