import * as vscode from 'vscode';
import {
  ClientCapabilities,
  DocumentSelector,
  LanguageClient,
  RequestType,
  ServerCapabilities,
  StaticFeature,
  TextDocumentIdentifier,
} from 'vscode-languageclient';
import { StatusFeature } from './status';

interface BuildTextDocumentParams {
  textDocument: TextDocumentIdentifier;
}

abstract class BuildTextDocumentRequest {
  public static type = new RequestType<
    BuildTextDocumentParams,
    BuildStatus,
    void,
    void
  >('textDocument/build');
}

export enum BuildStatus {
  Success,
  Error,
  Failure,
}

export class BuildFeature implements StaticFeature {
  private subscription: vscode.Disposable | undefined;

  constructor(
    private client: LanguageClient,
    private statusFeature: StatusFeature,
  ) {}

  public fillClientCapabilities(_capabilities: ClientCapabilities) {}

  public initialize(
    _capabilities: ServerCapabilities,
    documentSelector: DocumentSelector,
  ) {
    if (this.subscription !== undefined) {
      return;
    }

    this.subscription = vscode.commands.registerTextEditorCommand(
      'latex.build',
      async editor => this.build(editor, documentSelector),
    );
  }

  public dispose() {
    if (this.subscription) {
      this.subscription.dispose();
      this.subscription = undefined;
    }
  }

  private async build(
    { document }: vscode.TextEditor,
    documentSelector: DocumentSelector,
  ) {
    if (!vscode.languages.match(documentSelector, document)) {
      return;
    }

    if (document.uri.scheme !== 'file') {
      return;
    }

    if (document.isDirty && (await !document.save())) {
      return;
    }

    const params: BuildTextDocumentParams = {
      textDocument: this.client.code2ProtocolConverter.asTextDocumentIdentifier(
        document,
      ),
    };

    const status = await this.client.sendRequest(
      BuildTextDocumentRequest.type,
      params,
    );

    this.statusFeature.setBuildStatus(status);
  }
}
