import { merge, Observable } from 'rxjs';
import { flatMap, map } from 'rxjs/operators';
import * as vscode from 'vscode';
import { State, TransportKind } from 'vscode-languageclient';
import { BuildEngine } from './build';
import {
  BuildResult,
  CustomLanguageClient,
  ForwardSearchResult,
} from './client';
import {
  filterDocument,
  fromCommand,
  fromTextEditorCommand,
  skipNull,
} from './observable';
import {
  BIBTEX_FILE,
  BIBTEX_UNTITLED,
  LATEX_FILE,
  LATEX_UNTITLED,
} from './selectors';
import { View, ViewStatus } from './view';

export function activate(context: vscode.ExtensionContext) {
  const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
  const serverModule = context.asAbsolutePath('../texlab/out/main.js');
  const client = new CustomLanguageClient(
    'texlab',
    {
      run: { module: serverModule, transport: TransportKind.ipc },
      debug: {
        module: serverModule,
        transport: TransportKind.ipc,
        options: { execArgv: ['--nolazy', '--inspect=6009'], env },
      },
    },
    {
      documentSelector: [
        LATEX_FILE,
        LATEX_UNTITLED,
        BIBTEX_FILE,
        BIBTEX_UNTITLED,
      ],
      outputChannelName: 'LaTeX',
      uriConverters: {
        code2Protocol: uri => uri.toString(true),
        protocol2Code: value => vscode.Uri.parse(value),
      },
    },
  );

  const buildEngine = new BuildEngine(client);
  const view = new View();

  let subscriptions: vscode.Disposable[] = [];
  client.onDidChangeState(({ newState }) => {
    switch (newState) {
      case State.Running:
        view.subscribe(createStatusStream(client, buildEngine, subscriptions));
        break;
      case State.Stopped:
        view.unsubscribe();
        subscriptions.forEach(x => x.dispose());
        subscriptions = [];
        break;
    }
  });

  context.subscriptions.push(client.start(), buildEngine, view);
}

function createStatusStream(
  client: CustomLanguageClient,
  buildEngine: BuildEngine,
  subscriptions: vscode.Disposable[],
): Observable<ViewStatus> {
  const buildStatusStream = fromTextEditorCommand(
    'latex.build',
    subscriptions,
  ).pipe(
    filterDocument([LATEX_FILE, BIBTEX_FILE]),
    flatMap(({ document }) => buildEngine.build(document)),
    skipNull(),
    map<BuildResult, ViewStatus>(result => ({
      type: 'build',
      status: result.status,
    })),
  );

  const subscription = fromCommand(
    'latex.build.cancel',
    subscriptions,
  ).subscribe(() => buildEngine.cancel());

  subscriptions.push(new vscode.Disposable(() => subscription.unsubscribe()));

  const forwardSearchStatusStream = fromTextEditorCommand(
    'latex.forwardSearch',
    subscriptions,
  ).pipe(
    filterDocument(LATEX_FILE),
    flatMap(({ document, selection }) =>
      client.forwardSearch(document, selection.start),
    ),
    map<ForwardSearchResult, ViewStatus>(result => ({
      type: 'search',
      status: result.status,
    })),
  );

  return merge(buildStatusStream, forwardSearchStatusStream);
}
