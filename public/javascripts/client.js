

function loadData() {
	var pathArray = window.location.pathname.split( '/' );
    var file_id = pathArray[pathArray.length -1];
    var url = '/uploads/data/' + file_id;
    var adjust_mode = $("input:radio[name=adjustmentMethod]:checked").val();
    if (adjust_mode) {
        url += '?adjust_mode=' + adjust_mode;
    }
	var jqxhr = $.getJSON(url, function(data) {
		document.data = data;
		updateMaps();
		updateElevationChart();
		setDownloadLink();
		document.getElementById('loading');
		loading.style.display = 'none';
	})
	.done(function() { console.log( "loadData() completed successfully" ); })
	.fail(function(error) { console.log( "loadData() failed: " + error); })
	.always(function() { console.log( "Finished loadData()" ); });
}

function updateElevationChart() {
		var data = document.data;
		
		var colors = ['blue', 'red'];
		
		var chartData = [['Distance', 'Google Elevation', 'Uploaded Elevation']];
		if (data.adjustedElevation) {
		  chartData[0].push('Adjusted Elevation');
		  colors.push('green');
		}
		
		for (var i = 0; i < data.uploadElevation.length; i++) {
		    var googleElevation = data.googleElevation[i];
		    if (!googleElevation) {
		    	googleElevation = 0;
		    }
			chartData[i + 1] = [data.distance[i], googleElevation, data.uploadElevation[i]];
			if (data.adjustedElevation) {
              chartData[i + 1].push(data.adjustedElevation[i]);
            }
		}
		
        var dataTable = google.visualization.arrayToDataTable(chartData);

        var options = {
          title : 'Elevation',
          //hAxis: { title: 'Distance (km)', gridlines: {count:8}, viewWindow: {min:40, max:45}},
         // vAxis: { title: 'Elevation (m)', gridlines: {count:8}, viewWindow: {min:50, max:130}},
          
          hAxis: { title: 'Distance (km)', gridlines: {count:12}},
          vAxis: { title: 'Elevation (m)', gridlines: {count:8}},
          colors: colors
        }

        var chart = new google.visualization.LineChart(document.getElementById('elevation-canvas'));
        chart.draw(dataTable, options);
}

function updateMaps() {
	var data = document.data;
	var map_canvas = document.getElementById('map-canvas');
	
	// Only render once
	if (document.mapRendered) {
	   return;
	}
	document.mapRendered = true;
	
	if (!data || data.latitude.length == 0) {
		console.error("Cannot load map with no data.");
		return;
	}
	
	if (data.latitude.length !== data.longitude.length) {
		console.error("Data is corrupt, cannot load map.");
		return;
	}
    var middle = Math.round(data.latitude.length / 2);
  	var myLatLng = new google.maps.LatLng(data.latitude[middle], data.longitude[middle]);
  	var mapOptions = {
    	zoom: 11,
    	center: myLatLng,
    	mapTypeId: google.maps.MapTypeId.TERRAIN
 	 };

  	var map = new google.maps.Map(map_canvas, mapOptions);

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

function setDownloadLink() {
    var linkEl = document.getElementById('export_link');
    var suffix = '_adjusted';
    var file_name = document.data.file_name.replace(/(\.|$)/, suffix + "$&");
    var adjust_mode = $("input:radio[name=adjustmentMethod]:checked").val();
    var params = '';
    if (adjust_mode) {
        params = '&adjust_mode=' + adjust_mode;
    }
    linkEl.setAttribute('href', "/uploads/export/" + file_name + "?file_id=" + document.data.file_id + params);
}

function attachListeners() {
    $("input:radio[name=adjustmentMethod]").click(function() {
        setDownloadLink();
        loadData();
    });
}

google.maps.event.addDomListener(window, 'load', loadData);
google.maps.event.addDomListener(window, 'load', attachListeners);
