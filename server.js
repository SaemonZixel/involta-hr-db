var WebSocketServer = require('websocket').server;
var http = require('http');
var fs = require("fs");
var path = require("path");
var querystring = require('querystring');

// подключения
var clients = [null]; // чтоб client_id начинался с 1, а не с 0

// наша база данных работников
var workers = {"1": {id: 1, is_edited_by: null, updateted_ts: new Date()*1, fio: "Вася Иванов", position: "Тестер", salary: 40000, status: "сотрудник", date: "01.01.2020"}};


var server = http.createServer(function(request, response) {
    console.log((new Date()) + ' Received request for ' + request.url);
	
	try {
		if (request.url == "/") {
			
			// поищем уже существующий client_id в сессионной куке
			var cookie = request.headers["cookie"] || "";
			if (cookie.match(/your_client_id=[0-9]+/)) {
				var client_id = cookie.match(/your_client_id=([0-9]+)/)[1];
				
				// не зарегистрированный client_id? -> не будем использовать
				if(! clients[client_id]) 
					delete client_id;
			}
			
			// если новое подключение, то создадим новый client_id
			if (!client_id) {
				var client_id = clients.length;
				clients[client_id] = new Date(); // на всяк случай
			}
			
			// отправим GUI и в куке укажим их client_id
			response.writeHead(200, "OK", {
				"Content-Type": "text/html;charset=utf-8",
				"Set-Cookie": "your_client_id="+client_id
			});
			response.end(fs.readFileSync("index.html"));
		}
		
		// статика, такая статике...
		else if (["/vue.js", "/vuex.js", "/promise-polyfill.js"].indexOf(request.url) > -1) {
			response.writeHead(200, "OK", {
				"Content-Type": "text/javascript;charset=utf-8"
			});
			response.end(fs.readFileSync(request.url.replace(/^\//, "")));
		}
		
		else {
			response.writeHead(404);
			response.end();
		}
	
	} 
	catch(ex) {
			console.error(ex.stack||ex);
			response.writeHead(500, "Server Error");
			response.end(ex.stack||ex);
	}
});

server.listen(8081, function() {
    console.log((new Date()) + ' Server is listening on port 8081');
});
 
webSocketServer = new WebSocketServer({
    httpServer: server,
    autoAcceptConnections: false
});

webSocketServer.on('request', function(request) {

	// if (request.origin != '::ffff:127.0.0.1:8081') request.reject();
	
	var cookie = request.httpRequest.headers["cookie"];
	if (!cookie.match(/your_client_id=[0-9]+/)) {
		connection.sendUTF('{"error":true, "msg": "Unknown client_id! Reopen browser."}');
		connection.reject();
		return;
	}
	
	var connection = request.accept('echo-protocol', request.origin);
    console.log((new Date()) + ' Connection accepted.');
	
	// привяжем websocket-сединение к client_id
	var client_id = cookie.match(/your_client_id=([0-9]+)/)[1];
	clients[client_id] = connection;
	
	console.log("Registered with client_id=" + client_id);

	connection.on('message', function(message) {
		
		// найдём соответствующий client_id для этого соединения
		for (var client_id in clients) {
			if (clients[client_id] == this) break;
		}
		if (clients[client_id] != this) {
			connection.sendUTF('{"error":true, "msg":"Ваше соединение не зарегистрировано!"}');
			connection.close();
		}
		
		if (message.type === 'utf8') {
            console.log('Received Message: ' + message.utf8Data);
			
			var req = message.utf8Data[0] == '{' ? JSON.parse(message.utf8Data) : {};
			
			if (req.action == 'get_workers') {
				connection.sendUTF(JSON.stringify({
					error: false, 
					vuex_action: 'set_workers',
					data: workers
				}));
			}
			
			else if (req.action == 'add_worker') {
				var max_id = 0;
				for(var id in workers) 
					if (id >= max_id) max_id = id*1 + 1;
				
				req.worker.id = max_id;
				req.worker.is_edited_by = null;
				req.worker.updateted_ts = new Date()*1;
				workers[max_id] = req.worker;
				
				send_worker_to_all_clients(req.worker, 'set_worker', 'new_worker_cancel_form');
			}
			
			else if (req.action == 'lock_worker') {
				if (req.worker_id in workers == false) {
					connection.sendUTF('{"error":true, "msg": "Неизвестный ID ('+req.worker_id+')"}');
					return;
				}
				
				workers[req.worker_id].is_edited_by = client_id;
				workers[req.worker_id].updateted_ts = new Date()*1;
				
				send_worker_to_all_clients(workers[req.worker_id]);
			}
			
			else if (req.action == 'edit_worker') {
				if (req.worker.id in workers == false) {
					connection.sendUTF('{"error":true, "msg": "Неизвестный ID ('+req.worker.id+')"}');
					return;
				}
				
				workers[req.worker.id].fio = req.worker.fio;
				workers[req.worker.id].position = req.worker.position;
				workers[req.worker.id].salary = req.worker.salary;
				workers[req.worker.id].status = req.worker.status;
				workers[req.worker.id].date = req.worker.date;
				workers[req.worker.id].updateted_ts = new Date()*1;
				
				// сразу разблокируем
				workers[req.worker.id].is_edited_by = null;
				
				send_worker_to_all_clients(workers[req.worker.id]);
			}
			
			else if (req.action == 'unlock_worker') {
				if (req.worker_id in workers == false) {
					connection.sendUTF('{"error":true, "msg": "Неизвестный ID ('+req.worker_id+')"}');
					return;
				}
				
				workers[req.worker_id].is_edited_by = null;
				workers[req.worker_id].updateted_ts = new Date()*1;
				
				send_worker_to_all_clients(workers[req.worker_id]);
			}
			
			else if (req.action == 'remove_worker') {
				if (req.worker_id in workers == false) {
					connection.sendUTF('{"error":true, "msg": "Неизвестный ID ('+req.worker_id+')"}');
					return;
				}
				
				delete workers[req.worker_id];
				
				send_worker_to_all_clients(workers[req.worker_id], 'remove_worker');
			}
			
			// синхронизация базы клиента с сервером
			// TODO может всё сделать через synchronize_workers?
			else if (req.action == 'synchronize_workers') {
				// изменения
				changed_workers = {};
				
				// прежде всего удалим удалёные
				for (var id in req.workers)
					if (id in workers == false) 
						changed_workers[id] = null; // DELETE
				
				// добавим новые и скорректируем изменёные
				for(var id in workers)
					// INSERT
					if (id in req.workers == false)
						changed_workers[id] = workers[id];
					// UPDATE
					else if (req.workers[id]*1 < workers[id].updateted_ts*1)
						changed_workers[id] = workers[id];
					// (not modified)
					else
						continue;
					
				connection.sendUTF(JSON.stringify({
					error: false,
					vuex_action: 'synchronize_workers',
					data: changed_workers
				}));
			}
			
			else
				connection.sendUTF('{"error":true, "msg": "Unknown request!", "request": '+message.utf8Data+'}');
			
		}
		else if (message.type === 'binary') {
			console.log('Received Binary Message of ' + message.binaryData.length + ' bytes');
			connection.sendBytes('{"error": true, "msg": "Binary data not allowed!"}');
		}
	});

	connection.on('close', function() {
		console.log((new Date()) + ' Peer ' + connection.remoteAddress + ' disconnected.');
		console.log('Connection closed for client_id=' + client_id);
		delete clients[client_id];
		
		// снимем блокировки со всех редактируемых записей этим пользователем
		for (var id in workers)
			if (workers[id].is_edited_by == client_id) {
				workers[id].is_edited_by = null;
				send_worker_to_all_clients(workers[id]);
			}
	});

});

function send_worker_to_all_clients(worker, vuex_action, vue_action) {
	for (var client_id in clients)
		if (clients[client_id]) {
			clients[client_id].sendUTF(JSON.stringify({
				error: false,
				vuex_action: vuex_action || 'set_worker',
				vue_action: vue_action || '',
				data: worker
			}));
		}
}