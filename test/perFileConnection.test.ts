import assert = require("assert");
import * as TypeMoq from "typemoq";
import { ExtensionContext } from "vscode";

import { IPrompter } from "../src/prompts/question";
import SqlToolsServiceClient from "./../src/languageservice/serviceclient";

import ConnectionManager from "../src/controllers/connectionManager";
import {
	IConnectionCredentials,
	AuthenticationTypes,
} from "../src/models/interfaces";
import * as ConnectionContracts from "../src/models/contracts/connection";
import * as LanguageServiceContracts from "../src/models/contracts/languageService";
import MainController from "../src/controllers/mainController";
import * as Interfaces from "../src/models/interfaces";
import { ConnectionStore } from "../src/models/connectionStore";
import StatusView from "../src/views/statusView";
import Telemetry from "../src/models/telemetry";
import * as Utils from "../src/models/utils";
import { TestExtensionContext, TestPrompter } from "./stubs";
import VscodeWrapper from "../src/controllers/vscodeWrapper";
import LocalizedConstants = require("../src/constants/localizedConstants");
import { ConnectionUI } from "../src/views/connectionUI";
import Constants = require("../src/constants/constants");

function createTestConnectionResult(
	ownerUri?: string
): ConnectionContracts.ConnectionCompleteParams {
	let result = new ConnectionContracts.ConnectionCompleteParams();
	result.connectionId = Utils.generateGuid();
	result.messages = "";
	result.ownerUri = ownerUri;
	return result;
}

function createTestFailedConnectionResult(
	ownerUri?: string,
	error?: number
): ConnectionContracts.ConnectionCompleteParams {
	let result = new ConnectionContracts.ConnectionCompleteParams();
	result.errorNumber = error;
	result.errorMessage = "connection failed";
	result.ownerUri = ownerUri;
	return result;
}

function createTestCredentials(): IConnectionCredentials {
	const creds: IConnectionCredentials = {
		host: "my-server",
		dbname: "my_db",
		user: "sa",
		password: "12345678",
		port: 1234,
		authenticationType: AuthenticationTypes[AuthenticationTypes.SqlLogin],
		encrypt: false,
		trustServerCertificate: false,
		persistSecurityInfo: false,
		connectTimeout: 15,
		connectRetryCount: 0,
		connectRetryInterval: 0,
		applicationName: "vscode-pgsql",
		workstationId: "test",
		applicationIntent: "",
		currentLanguage: "",
		pooling: true,
		maxPoolSize: 15,
		minPoolSize: 0,
		loadBalanceTimeout: 0,
		replication: false,
		attachDbFilename: "",
		failoverPartner: "",
		multiSubnetFailover: false,
		multipleActiveResultSets: false,
		packetSize: 8192,
		typeSystemVersion: "Latest",
		connectionString: "",
		hostaddr: "",
		clientEncoding: "",
		options: "",
		sslmode: "prefer",
		sslcompression: false,
		sslcert: "",
		sslkey: "",
		sslrootcert: "",
		sslcrl: "",
		requirepeer: "",
		service: "",
	};
	return creds;
}

function createTestConnectionManager(
	serviceClient?: SqlToolsServiceClient,
	wrapper?: VscodeWrapper,
	statusView?: StatusView,
	connectionStore?: ConnectionStore,
	connectionUI?: ConnectionUI
): ConnectionManager {
	let contextMock: TypeMoq.IMock<ExtensionContext> =
		TypeMoq.Mock.ofType(TestExtensionContext);
	let prompterMock: TypeMoq.IMock<IPrompter> =
		TypeMoq.Mock.ofType(TestPrompter);
	if (!statusView) {
		statusView = TypeMoq.Mock.ofType(StatusView).object;
	}
	if (!connectionStore) {
		let connectionStoreMock = TypeMoq.Mock.ofType(ConnectionStore);
		// disable saving recently used by default
		connectionStoreMock
			.setup((x) => x.addRecentlyUsed(TypeMoq.It.isAny()))
			.returns(() => {
				return Promise.resolve();
			});
		connectionStore = connectionStoreMock.object;
	}
	return new ConnectionManager(
		contextMock.object,
		statusView,
		prompterMock.object,
		serviceClient,
		wrapper,
		connectionStore,
		connectionUI
	);
}

function createTestListDatabasesResult(): ConnectionContracts.ListDatabasesResult {
	let result = new ConnectionContracts.ListDatabasesResult();
	result.databaseNames = ["master", "model", "msdb", "tempdb", "mydatabase"];
	return result;
}

suite("Per File Connection Tests", () => {
	setup(() => {
		// Ensure that telemetry is disabled while testing
		Telemetry.disable();
	});

	test("onNewConnection should ask user for different credentials if connection failed because of invalid credentials", (done) => {
		let vscodeWrapperMock: TypeMoq.IMock<VscodeWrapper> =
			TypeMoq.Mock.ofType(VscodeWrapper);
		let none: void;
		const testFile = "file:///my/test/file.sql";
		vscodeWrapperMock.callBase = true;
		vscodeWrapperMock.setup((x) => x.isEditingSqlFile).returns(() => false);
		vscodeWrapperMock
			.setup((x) => x.logToOutputChannel(TypeMoq.It.isAny()))
			.returns(() => none);
		vscodeWrapperMock
			.setup((x) => x.activeTextEditorUri)
			.returns(() => testFile);

		let connectionCreds = createTestCredentials();

		let connectionUIMock = TypeMoq.Mock.ofType(ConnectionUI);
		connectionUIMock
			.setup((x) => x.promptToChangeLanguageMode())
			.returns((x) => Promise.resolve(true));
		connectionUIMock
			.setup((x) => x.showConnections())
			.returns((x) => Promise.resolve(connectionCreds));

		// Return undefined to simulate the scenario that user doesn't want to enter new credentials
		connectionUIMock
			.setup((x) =>
				x.createProfileWithDifferentCredentials(TypeMoq.It.isAny())
			)
			.returns((x) => Promise.resolve(undefined));
		let manager: ConnectionManager = createTestConnectionManager(
			undefined,
			vscodeWrapperMock.object,
			undefined,
			undefined,
			connectionUIMock.object
		);

		// Setup mocking
		let serviceClientMock: TypeMoq.IMock<SqlToolsServiceClient> =
			TypeMoq.Mock.ofType(SqlToolsServiceClient);
		serviceClientMock
			.setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
			.callback((type, params: ConnectionContracts.ConnectParams) => {
				manager.handleConnectionCompleteNotification().call(
					manager,
					// Make connection fail with login failed error
					createTestFailedConnectionResult(
						params.ownerUri,
						Constants.errorLoginFailed
					)
				);
			})
			.returns(() => Promise.resolve(true));

		manager.client = serviceClientMock.object;

		manager
			.onNewConnection()
			.then((result) => {
				connectionUIMock.verify(
					(x) =>
						x.createProfileWithDifferentCredentials(
							TypeMoq.It.isAny()
						),
					TypeMoq.Times.once()
				);
				done();
			})
			.catch((err) => {
				done(err);
			});
	});

	test("onNewConnection only prompt user for new credentials onces even if the connection fails again", (done) => {
		let vscodeWrapperMock: TypeMoq.IMock<VscodeWrapper> =
			TypeMoq.Mock.ofType(VscodeWrapper);
		let none: void;
		const testFile = "file:///my/test/file.sql";
		vscodeWrapperMock.callBase = true;
		vscodeWrapperMock.setup((x) => x.isEditingSqlFile).returns(() => false);
		vscodeWrapperMock
			.setup((x) => x.logToOutputChannel(TypeMoq.It.isAny()))
			.returns(() => none);
		vscodeWrapperMock
			.setup((x) => x.activeTextEditorUri)
			.returns(() => testFile);

		let connectionCreds = createTestCredentials();

		let connectionUIMock = TypeMoq.Mock.ofType(ConnectionUI);
		connectionUIMock
			.setup((x) => x.promptToChangeLanguageMode())
			.returns((x) => Promise.resolve(true));
		connectionUIMock
			.setup((x) => x.showConnections())
			.returns((x) => Promise.resolve(connectionCreds));

		connectionUIMock
			.setup((x) =>
				x.createProfileWithDifferentCredentials(TypeMoq.It.isAny())
			)
			.returns((x) => Promise.resolve(connectionCreds));
		let manager: ConnectionManager = createTestConnectionManager(
			undefined,
			vscodeWrapperMock.object,
			undefined,
			undefined,
			connectionUIMock.object
		);

		// Setup mocking
		let serviceClientMock: TypeMoq.IMock<SqlToolsServiceClient> =
			TypeMoq.Mock.ofType(SqlToolsServiceClient);
		serviceClientMock
			.setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
			.callback((type, params: ConnectionContracts.ConnectParams) => {
				manager.handleConnectionCompleteNotification().call(
					manager,
					// Make connection fail with login failed error
					createTestFailedConnectionResult(
						params.ownerUri,
						Constants.errorLoginFailed
					)
				);
			})
			.returns(() => Promise.resolve(true));

		manager.client = serviceClientMock.object;

		manager
			.onNewConnection()
			.then((result) => {
				connectionUIMock.verify(
					(x) =>
						x.createProfileWithDifferentCredentials(
							TypeMoq.It.isAny()
						),
					TypeMoq.Times.once()
				);
				done();
			})
			.catch((err) => {
				done(err);
			});
	});

	test("Can create two separate connections for two files", (done) => {
		const testFile1 = "file:///my/test/file.sql";
		const testFile2 = "file:///my/test/file2.sql";

		let manager: ConnectionManager = createTestConnectionManager();

		// Setup mocking
		let serviceClientMock: TypeMoq.IMock<SqlToolsServiceClient> =
			TypeMoq.Mock.ofType(SqlToolsServiceClient);
		serviceClientMock
			.setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
			.callback((type, params: ConnectionContracts.ConnectParams) => {
				manager
					.handleConnectionCompleteNotification()
					.call(manager, createTestConnectionResult(params.ownerUri));
			})
			.returns(() => Promise.resolve(true));

		manager.client = serviceClientMock.object;

		// Create two different connections using the connection manager
		let connectionCreds = createTestCredentials();
		let connectionCreds2 = createTestCredentials();
		connectionCreds2.dbname = "my_other_db";

		manager
			.connect(testFile1, connectionCreds)
			.then((result) => {
				assert.equal(result, true);
				manager
					.connect(testFile2, connectionCreds)
					.then((result2) => {
						assert.equal(result2, true);

						// Check that two connections were established
						assert.equal(manager.connectionCount, 2);
						assert.equal(manager.isConnected(testFile1), true);
						assert.equal(manager.isConnected(testFile2), true);
						done();
					})
					.catch((err) => {
						done(err);
					});
			})
			.catch((err) => {
				done(err);
			});
	});

	test("Can disconnect one file while another file stays connected", (done) => {
		const testFile1 = "file:///my/test/file.sql";
		const testFile2 = "file:///my/test/file2.sql";

		let manager: ConnectionManager = createTestConnectionManager();

		// Setup mocking
		let serviceClientMock: TypeMoq.IMock<SqlToolsServiceClient> =
			TypeMoq.Mock.ofType(SqlToolsServiceClient);
		serviceClientMock
			.setup((x) =>
				x.sendRequest(
					TypeMoq.It.isValue(
						ConnectionContracts.ConnectionRequest.type
					),
					TypeMoq.It.isAny()
				)
			)
			.callback((type, params: ConnectionContracts.ConnectParams) => {
				manager
					.handleConnectionCompleteNotification()
					.call(manager, createTestConnectionResult(params.ownerUri));
			})
			.returns(() => Promise.resolve(true));
		serviceClientMock
			.setup((x) =>
				x.sendRequest(
					TypeMoq.It.isValue(
						ConnectionContracts.DisconnectRequest.type
					),
					TypeMoq.It.isAny()
				)
			)
			.returns(() => Promise.resolve(true));

		manager.client = serviceClientMock.object;

		// Create two different connections using the connection manager
		let connectionCreds = createTestCredentials();
		let connectionCreds2 = createTestCredentials();
		connectionCreds2.dbname = "my_other_db";

		manager
			.connect(testFile1, connectionCreds)
			.then((result) => {
				assert.equal(result, true);
				manager
					.connect(testFile2, connectionCreds)
					.then((result2) => {
						assert.equal(result2, true);

						// Check that two connections were established
						assert.equal(manager.connectionCount, 2);
						assert.equal(manager.isConnected(testFile1), true);
						assert.equal(manager.isConnected(testFile2), true);

						// Disconnect one of the files
						manager
							.disconnect(testFile2)
							.then((result3) => {
								assert.equal(result3, true);

								// Check that only the second file disconnected
								assert.equal(manager.connectionCount, 1);
								assert.equal(
									manager.isConnected(testFile1),
									true
								);
								assert.equal(
									manager.isConnected(testFile2),
									false
								);

								done();
							})
							.catch((err) => {
								done(err);
							});
					})
					.catch((err) => {
						done(err);
					});
			})
			.catch((err) => {
				done(err);
			});
	});

	test("Can disconnect and reconnect one file while another file stays connected", (done) => {
		const testFile1 = "file:///my/test/file.sql";
		const testFile2 = "file:///my/test/file2.sql";

		let manager: ConnectionManager = createTestConnectionManager();

		// Setup mocking
		let serviceClientMock: TypeMoq.IMock<SqlToolsServiceClient> =
			TypeMoq.Mock.ofType(SqlToolsServiceClient);
		serviceClientMock
			.setup((x) =>
				x.sendRequest(
					TypeMoq.It.isValue(
						ConnectionContracts.ConnectionRequest.type
					),
					TypeMoq.It.isAny()
				)
			)
			.callback((type, params: ConnectionContracts.ConnectParams) => {
				manager
					.handleConnectionCompleteNotification()
					.call(manager, createTestConnectionResult(params.ownerUri));
			})
			.returns(() => Promise.resolve(true));
		serviceClientMock
			.setup((x) =>
				x.sendRequest(
					TypeMoq.It.isValue(
						ConnectionContracts.DisconnectRequest.type
					),
					TypeMoq.It.isAny()
				)
			)
			.returns(() => Promise.resolve(true));

		manager.client = serviceClientMock.object;

		// Create two different connections using the connection manager
		let connectionCreds = createTestCredentials();
		let connectionCreds2 = createTestCredentials();
		connectionCreds2.dbname = "my_other_db";

		manager
			.connect(testFile1, connectionCreds)
			.then((result) => {
				assert.equal(result, true);
				manager
					.connect(testFile2, connectionCreds)
					.then((result2) => {
						assert.equal(result2, true);

						// Check that two connections were established
						assert.equal(manager.connectionCount, 2);
						assert.equal(manager.isConnected(testFile1), true);
						assert.equal(manager.isConnected(testFile2), true);

						// Disconnect one of the files
						manager
							.disconnect(testFile2)
							.then((result3) => {
								assert.equal(result3, true);

								// Check that only the second file disconnected
								assert.equal(manager.connectionCount, 1);
								assert.equal(
									manager.isConnected(testFile1),
									true
								);
								assert.equal(
									manager.isConnected(testFile2),
									false
								);

								// Reconnect the second file
								manager
									.connect(testFile2, connectionCreds2)
									.then((result4) => {
										assert.equal(result4, true);

										// Check that two connections are estabilished
										assert.equal(
											manager.connectionCount,
											2
										);
										assert.equal(
											manager.isConnected(testFile1),
											true
										);
										assert.equal(
											manager.isConnected(testFile2),
											true
										);

										done();
									})
									.catch((err) => {
										done(err);
									});
							})
							.catch((err) => {
								done(err);
							});
					})
					.catch((err) => {
						done(err);
					});
			})
			.catch((err) => {
				done(err);
			});
	});

	test("Can list databases on server used by current connection and switch databases", (done) => {
		const testFile = "file:///my/test/file.sql";

		let manager: ConnectionManager = createTestConnectionManager();

		// Setup mocking
		let serviceClientMock: TypeMoq.IMock<SqlToolsServiceClient> =
			TypeMoq.Mock.ofType(SqlToolsServiceClient);
		serviceClientMock
			.setup((x) =>
				x.sendRequest(
					TypeMoq.It.isValue(
						ConnectionContracts.ConnectionRequest.type
					),
					TypeMoq.It.isAny()
				)
			)
			.callback((type, params: ConnectionContracts.ConnectParams) => {
				manager
					.handleConnectionCompleteNotification()
					.call(manager, createTestConnectionResult(params.ownerUri));
			})
			.returns(() => Promise.resolve(true));
		serviceClientMock
			.setup((x) =>
				x.sendRequest(
					TypeMoq.It.isValue(
						ConnectionContracts.DisconnectRequest.type
					),
					TypeMoq.It.isAny()
				)
			)
			.returns(() => Promise.resolve(true));
		serviceClientMock
			.setup((x) =>
				x.sendRequest(
					TypeMoq.It.isValue(
						ConnectionContracts.ListDatabasesRequest.type
					),
					TypeMoq.It.isAny()
				)
			)
			.returns(() => Promise.resolve(createTestListDatabasesResult()));

		let newDatabaseCredentials = createTestCredentials();
		newDatabaseCredentials.dbname = "master";

		const newDatabaseChoice = <
			Interfaces.IConnectionCredentialsQuickPickItem
		>{
			label: "master",
			description: "",
			detail: "",
			connectionCreds: newDatabaseCredentials,
			quickPickItemType: Interfaces.CredentialsQuickPickItemType.Mru,
		};

		let vscodeWrapperMock: TypeMoq.IMock<VscodeWrapper> =
			TypeMoq.Mock.ofType(VscodeWrapper);
		vscodeWrapperMock.callBase = true;
		vscodeWrapperMock
			.setup((x) =>
				x.showQuickPick(TypeMoq.It.isAny(), TypeMoq.It.isAny())
			)
			.returns(() => Promise.resolve(newDatabaseChoice));
		vscodeWrapperMock
			.setup((x) => x.activeTextEditorUri)
			.returns(() => testFile);

		manager.client = serviceClientMock.object;
		manager.vscodeWrapper = vscodeWrapperMock.object;
		manager.connectionUI.vscodeWrapper = vscodeWrapperMock.object;

		// Open a connection using the connection manager
		let connectionCreds = createTestCredentials();

		manager
			.connect(testFile, connectionCreds)
			.then((result) => {
				assert.equal(result, true);

				// Check that the connection was established
				assert.equal(manager.isConnected(testFile), true);
				assert.equal(
					manager.getConnectionInfo(testFile).credentials.dbname,
					connectionCreds.dbname
				);

				// Change databases
				manager
					.onChooseDatabase()
					.then((result2) => {
						assert.equal(result2, true);

						// Check that databases on the server were listed
						serviceClientMock.verify(
							(x) =>
								x.sendRequest(
									TypeMoq.It.isValue(
										ConnectionContracts.ListDatabasesRequest
											.type
									),
									TypeMoq.It.isAny()
								),
							TypeMoq.Times.once()
						);
						vscodeWrapperMock.verify(
							(x) =>
								x.showQuickPick(
									TypeMoq.It.isAny(),
									TypeMoq.It.isAny()
								),
							TypeMoq.Times.once()
						);

						// Check that the database was changed
						assert.equal(manager.isConnected(testFile), true);
						assert.equal(
							manager.getConnectionInfo(testFile).credentials
								.dbname,
							"master"
						);

						done();
					})
					.catch((err) => {
						done(err);
					});
			})
			.catch((err) => {
				done(err);
			});
	});

	test("Can disconnect instead of switching databases", (done) => {
		const testFile = "file:///my/test/file.sql";

		let manager: ConnectionManager = createTestConnectionManager();

		// Setup mocking
		let serviceClientMock: TypeMoq.IMock<SqlToolsServiceClient> =
			TypeMoq.Mock.ofType(SqlToolsServiceClient);
		serviceClientMock
			.setup((x) =>
				x.sendRequest(
					TypeMoq.It.isValue(
						ConnectionContracts.ConnectionRequest.type
					),
					TypeMoq.It.isAny()
				)
			)
			.callback((type, params: ConnectionContracts.ConnectParams) => {
				manager
					.handleConnectionCompleteNotification()
					.call(manager, createTestConnectionResult(params.ownerUri));
			})
			.returns(() => Promise.resolve(true));
		serviceClientMock
			.setup((x) =>
				x.sendRequest(
					TypeMoq.It.isValue(
						ConnectionContracts.DisconnectRequest.type
					),
					TypeMoq.It.isAny()
				)
			)
			.returns(() => Promise.resolve(true));
		serviceClientMock
			.setup((x) =>
				x.sendRequest(
					TypeMoq.It.isValue(
						ConnectionContracts.ListDatabasesRequest.type
					),
					TypeMoq.It.isAny()
				)
			)
			.returns(() => Promise.resolve(createTestListDatabasesResult()));

		let newDatabaseCredentials = createTestCredentials();
		newDatabaseCredentials.dbname = "master";

		let vscodeWrapperMock: TypeMoq.IMock<VscodeWrapper> =
			TypeMoq.Mock.ofType(VscodeWrapper);
		vscodeWrapperMock.callBase = true;
		vscodeWrapperMock
			.setup((x) => x.activeTextEditorUri)
			.returns(() => testFile);

		manager.client = serviceClientMock.object;
		manager.vscodeWrapper = vscodeWrapperMock.object;
		manager.connectionUI.vscodeWrapper = vscodeWrapperMock.object;

		// Override the database list prompt to select the disconnect option and the promptSingle method to automatically return true
		manager.connectionUI.vscodeWrapper.showQuickPick = function (
			options: any[]
		): any {
			return Promise.resolve(
				options.find(
					(option) =>
						option.label ===
						LocalizedConstants.disconnectOptionLabel
				)
			);
		};
		(manager.connectionUI as any)._prompter.promptSingle = function (
			_: any
		): Promise<boolean> {
			return Promise.resolve(true);
		};

		// Open a connection using the connection manager
		let connectionCreds = createTestCredentials();

		manager
			.connect(testFile, connectionCreds)
			.then((result) => {
				assert.equal(result, true);

				// Check that the connection was established
				assert.equal(manager.isConnected(testFile), true);
				assert.equal(
					manager.getConnectionInfo(testFile).credentials.dbname,
					connectionCreds.dbname
				);

				// Change databases
				manager
					.onChooseDatabase()
					.then((result2) => {
						assert.equal(result2, false);

						// Check that databases on the server were listed
						serviceClientMock.verify(
							(x) =>
								x.sendRequest(
									TypeMoq.It.isValue(
										ConnectionContracts.ListDatabasesRequest
											.type
									),
									TypeMoq.It.isAny()
								),
							TypeMoq.Times.once()
						);

						// Check that the database was disconnected
						assert.equal(manager.isConnected(testFile), false);

						done();
					})
					.catch((err) => {
						done(err);
					});
			})
			.catch((err) => {
				done(err);
			});
	});

	test("Prompts for new connection before running query if disconnected", () => {
		// Setup mocking
		let contextMock: TypeMoq.IMock<ExtensionContext> =
			TypeMoq.Mock.ofType(TestExtensionContext);
		let vscodeWrapperMock: TypeMoq.IMock<VscodeWrapper> =
			TypeMoq.Mock.ofType(VscodeWrapper);
		vscodeWrapperMock.setup((x) => x.isEditingSqlFile).returns(() => true);
		vscodeWrapperMock
			.setup((x) => x.activeTextEditorUri)
			.returns(() => "file://my/test/file.sql");
		let connectionManagerMock: TypeMoq.IMock<ConnectionManager> =
			TypeMoq.Mock.ofType(ConnectionManager);
		connectionManagerMock
			.setup((x) => x.isConnected(TypeMoq.It.isAny()))
			.returns(() => false);
		connectionManagerMock
			.setup((x) => x.isConnected(TypeMoq.It.isAny()))
			.returns(() => true);
		connectionManagerMock
			.setup((x) => x.onNewConnection())
			.returns(() => Promise.resolve(false));

		let controller: MainController = new MainController(
			contextMock.object,
			connectionManagerMock.object,
			vscodeWrapperMock.object
		);

		// Attempt to run a query without connecting
		controller.onRunQuery();
		connectionManagerMock.verify(
			(x) => x.onNewConnection(),
			TypeMoq.Times.once()
		);
	});

	test("Change connection notification changes database context", (done) => {
		const testFile = "file:///my/test/file.sql";

		let connectionManager: ConnectionManager =
			createTestConnectionManager();

		// Setup mocking
		let serviceClientMock: TypeMoq.IMock<SqlToolsServiceClient> =
			TypeMoq.Mock.ofType(SqlToolsServiceClient);
		serviceClientMock
			.setup((x) =>
				x.sendRequest(
					TypeMoq.It.isValue(
						ConnectionContracts.ConnectionRequest.type
					),
					TypeMoq.It.isAny()
				)
			)
			.callback((type, params: ConnectionContracts.ConnectParams) => {
				connectionManager
					.handleConnectionCompleteNotification()
					.call(
						connectionManager,
						createTestConnectionResult(params.ownerUri)
					);
			})
			.returns(() => Promise.resolve(true));

		connectionManager.client = serviceClientMock.object;

		// Open a connection using the connection manager
		let connectionCreds = createTestCredentials();

		connectionManager.connect(testFile, connectionCreds).then((result) => {
			assert.equal(result, true);

			// Check that the connection was established
			assert.equal(connectionManager.isConnected(testFile), true);
			assert.equal(
				connectionManager.getConnectionInfo(testFile).credentials
					.dbname,
				connectionCreds.dbname
			);

			// Simulate a connection changed notification
			let parameters = new ConnectionContracts.ConnectionChangedParams();
			parameters.ownerUri = testFile;
			parameters.connection = new ConnectionContracts.ConnectionSummary();
			parameters.connection.serverName = connectionCreds.host;
			parameters.connection.databaseName = "myOtherDatabase";
			parameters.connection.userName = connectionCreds.user;

			let notificationObject =
				connectionManager.handleConnectionChangedNotification();
			notificationObject.call(connectionManager, parameters);

			// Verify that the connection changed to the other database for the file
			assert.equal(
				connectionManager.getConnectionInfo(testFile).credentials
					.dbname,
				"myOtherDatabase"
			);

			done();
		});
	});

	test("Should use actual database name instead of <default>", (done) => {
		const testFile = "file:///my/test/file.sql";
		const expectedDbName = "master";

		let manager: ConnectionManager = createTestConnectionManager();

		// Given a connection to default database
		let connectionCreds = createTestCredentials();
		connectionCreds.dbname = "";

		// When the result will return 'master' as the database connected to
		let myResult = createConnectionResultForCreds(
			connectionCreds,
			expectedDbName
		);
		myResult.ownerUri = testFile;

		let serviceClientMock: TypeMoq.IMock<SqlToolsServiceClient> =
			TypeMoq.Mock.ofType(SqlToolsServiceClient);
		serviceClientMock
			.setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
			.callback((type, params: ConnectionContracts.ConnectParams) => {
				manager
					.handleConnectionCompleteNotification()
					.call(manager, myResult);
			})
			.returns(() => Promise.resolve(true));

		let statusViewMock: TypeMoq.IMock<StatusView> =
			TypeMoq.Mock.ofType(StatusView);
		let actualDbName = undefined;
		statusViewMock
			.setup((x) =>
				x.connectSuccess(
					TypeMoq.It.isAny(),
					TypeMoq.It.isAny(),
					TypeMoq.It.isAny()
				)
			)
			.callback(
				(
					fileUri,
					creds: IConnectionCredentials,
					server: ConnectionContracts.ServerInfo
				) => {
					actualDbName = creds.dbname;
				}
			);

		manager.client = serviceClientMock.object;
		manager.statusView = statusViewMock.object;

		// Then on connecting expect 'master' to be the database used in status view and URI mapping
		manager
			.connect(testFile, connectionCreds)
			.then((result) => {
				assert.equal(result, true);
				assert.equal(
					manager.getConnectionInfo(testFile).credentials.dbname,
					expectedDbName
				);
				assert.equal(actualDbName, expectedDbName);

				done();
			})
			.catch((err) => {
				done(err);
			});
	});

	function createConnectionResultForCreds(
		connectionCreds: IConnectionCredentials,
		dbName?: string
	): ConnectionContracts.ConnectionCompleteParams {
		let myResult = new ConnectionContracts.ConnectionCompleteParams();
		if (!dbName) {
			dbName = connectionCreds.dbname;
		}
		myResult.connectionId = Utils.generateGuid();
		myResult.messages = "";
		myResult.connectionSummary = {
			serverName: connectionCreds.host,
			databaseName: dbName,
			userName: connectionCreds.user,
		};
		myResult.serverInfo = new ConnectionContracts.ServerInfo();
		return myResult;
	}

	test("Should save new connections to recently used list", (done) => {
		const testFile = "file:///my/test/file.sql";
		const expectedDbName = "master";

		let manager: ConnectionManager = createTestConnectionManager();

		// Given a connection to default database
		let connectionCreds = createTestCredentials();
		connectionCreds.dbname = "";

		// When the result will return 'master' as the database connected to
		let myResult = createConnectionResultForCreds(
			connectionCreds,
			expectedDbName
		);
		myResult.ownerUri = testFile;

		let serviceClientMock: TypeMoq.IMock<SqlToolsServiceClient> =
			TypeMoq.Mock.ofType(SqlToolsServiceClient);
		serviceClientMock
			.setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
			.callback((type, params: ConnectionContracts.ConnectParams) => {
				manager
					.handleConnectionCompleteNotification()
					.call(manager, myResult);
			})
			.returns(() => Promise.resolve(true));

		let statusViewMock: TypeMoq.IMock<StatusView> =
			TypeMoq.Mock.ofType(StatusView);
		let actualDbName = undefined;
		statusViewMock
			.setup((x) =>
				x.connectSuccess(
					TypeMoq.It.isAny(),
					TypeMoq.It.isAny(),
					TypeMoq.It.isAny()
				)
			)
			.callback((fileUri, creds: IConnectionCredentials) => {
				actualDbName = creds.dbname;
			});

		// And we store any DBs saved to recent connections
		let savedConnection: IConnectionCredentials = undefined;
		let connectionStoreMock = TypeMoq.Mock.ofType(ConnectionStore);
		connectionStoreMock
			.setup((x) => x.addRecentlyUsed(TypeMoq.It.isAny()))
			.returns((conn) => {
				savedConnection = conn;
				return Promise.resolve();
			});

		manager.client = serviceClientMock.object;
		manager.statusView = statusViewMock.object;
		manager.connectionStore = connectionStoreMock.object;

		// Then on connecting expect 'master' to be the database used in status view and URI mapping
		manager
			.connect(testFile, connectionCreds)
			.then((result) => {
				assert.equal(result, true);
				connectionStoreMock.verify(
					(x) => x.addRecentlyUsed(TypeMoq.It.isAny()),
					TypeMoq.Times.once()
				);
				assert.equal(
					savedConnection.dbname,
					expectedDbName,
					"Expect actual DB name returned from connection to be saved"
				);
				assert.equal(
					savedConnection.password,
					connectionCreds.password,
					"Expect password to be saved"
				);

				done();
			})
			.catch((err) => {
				done(err);
			});
	});

	test("Status view shows updating intellisense after connecting and disappears after intellisense is updated", (done) => {
		const testFile = "file:///my/test/file.sql";

		let manager: ConnectionManager = createTestConnectionManager();
		let statusViewMock: TypeMoq.IMock<StatusView> =
			TypeMoq.Mock.ofType(StatusView);
		let serviceClientMock: TypeMoq.IMock<SqlToolsServiceClient> =
			TypeMoq.Mock.ofType(SqlToolsServiceClient);
		serviceClientMock
			.setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
			.callback((type, params: ConnectionContracts.ConnectParams) => {
				manager
					.handleConnectionCompleteNotification()
					.call(manager, createTestConnectionResult(params.ownerUri));
			})
			.returns(() => Promise.resolve(true));

		manager.statusView = statusViewMock.object;
		manager.client = serviceClientMock.object;

		// Connect
		manager
			.connect(testFile, createTestCredentials())
			.then((result) => {
				assert.equal(result, true);
				statusViewMock.verify(
					(x) =>
						x.languageServiceStatusChanged(
							TypeMoq.It.isAny(),
							LocalizedConstants.updatingIntelliSenseStatus
						),
					TypeMoq.Times.once()
				);
				statusViewMock.verify(
					(x) =>
						x.languageServiceStatusChanged(
							TypeMoq.It.isAny(),
							LocalizedConstants.intelliSenseUpdatedStatus
						),
					TypeMoq.Times.never()
				);

				// Send a mock notification that the language service was updated
				let langResult =
					new LanguageServiceContracts.IntelliSenseReadyParams();
				langResult.ownerUri = testFile;
				manager
					.handleLanguageServiceUpdateNotification()
					.call(manager, langResult);

				statusViewMock.verify(
					(x) =>
						x.languageServiceStatusChanged(
							TypeMoq.It.isAny(),
							LocalizedConstants.intelliSenseUpdatedStatus
						),
					TypeMoq.Times.once()
				);

				done();
			})
			.catch((err) => {
				done(err);
			});
	});
});
