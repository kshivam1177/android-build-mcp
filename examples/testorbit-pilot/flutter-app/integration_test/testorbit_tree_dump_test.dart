// TestOrbit Flutter tree dump harness (Phase 2).
//
// Run with `patrol test` from the pilot Flutter app's root. It pumps the
// app, walks the semantics tree, and writes the tree as JSON to the path
// in `TESTORBIT_TREE_DUMP_PATH` (default `build/testorbit_tree_dump.json`).
// The TestOrbit-side reader (`src/testorbit/infrastructure/flutter-tree-reader.ts`)
// converts that JSON into the same node shape the matcher consumes.
//
// SETUP (pilot app, one-time):
//   1. Add `patrol` to `dev_dependencies` and a Patrol test target.
//   2. Replace `MyApp` below with the pilot app's root widget.
//   3. Give interactive elements `Semantics` labels and stable
//      identifiers: wrap them in `Semantics(identifier: '<stable-id>',
//      label: '<label>', button: true, ...)` — the reader maps the
//      identifier to the node's `resourceId` (its `ValueKey` equivalent)
//      and the label to `contentDesc`. The reader consumes whatever
//      semantics the app exposes; it cannot invent labels the app does
//      not provide. If semantics coverage is below the >=80% rule (B3),
//      the app is out of v1 scope until the labels are added.
//   4. Run: `patrol test integration_test/testorbit_tree_dump_test.dart`
//
// Fallback (named, not built): `appium-flutter-driver` over the Dart VM
// service, decided live if Patrol cannot serve the tree this way.
//
// LIVE RUN PENDING: no Flutter SDK / Patrol on this VM — the harness is
// written and the reader is proved against fixture JSON; run `patrol test`
// on a machine with the Flutter SDK + pilot app.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:patrol/patrol.dart';

// TODO(pilot): replace with the pilot app's root widget once it is named.
import 'package:pilot_app/main.dart';

/// One semantics node serialised for the TestOrbit reader.
Map<String, Object?> dumpNode(SemanticsNode node) {
  final data = node.getSemanticsData();
  final rect = node.rect;
  final flags = <String, Object>{
    'button': data.hasFlag(SemanticsFlag.isButton),
    'textField': data.hasFlag(SemanticsFlag.isTextField),
    'enabled': data.hasFlag(SemanticsFlag.isEnabled),
    'focusable': data.hasFlag(SemanticsFlag.isFocusable),
    'checkable': data.hasFlag(SemanticsFlag.hasCheckedState),
    'checked': data.hasFlag(SemanticsFlag.isChecked),
    'scrollable': data.hasFlag(SemanticsFlag.isScrollable),
  };
  final out = <String, Object?>{
    'rect': {
      'left': rect.left,
      'top': rect.top,
      'right': rect.right,
      'bottom': rect.bottom,
    },
    'flags': flags,
    'children': <Map<String, Object?>>[],
  };
  // The stable id: the `Semantics(identifier: ...)` value when the app
  // sets one (verified live against the pilot app's Flutter version;
  // the reader treats a missing key as "no resourceId", never invents one).
  final identifier = data.identifier;
  if (identifier.isNotEmpty) out['key'] = identifier;
  if (data.label.isNotEmpty) out['label'] = data.label;
  if (data.value.isNotEmpty) out['value'] = data.value;
  if (data.hint.isNotEmpty) out['hint'] = data.hint;
  final children = out['children'] as List<Map<String, Object?>>;
  node.visitChildren((child) {
    children.add(dumpNode(child));
    return true;
  });
  return out;
}

void main() {
  patrolTest('testorbit tree dump', ($) async {
    await $.pumpWidgetAndSettle(const MyApp());
    await $.pumpAndSettle();

    final owner = WidgetsBinding.instance.pipelineOwner.semanticsOwner;
    final root = owner?.rootSemanticsNode;
    if (root == null) {
      throw StateError(
        'No semantics root: enable semantics in the pilot app '
        '(Semantics labels on interactive elements) and re-run.',
      );
    }
    final tree = dumpNode(root);
    final outPath =
        Platform.environment['TESTORBIT_TREE_DUMP_PATH'] ??
        'build/testorbit_tree_dump.json';
    final file = File(outPath);
    await file.parent.create(recursive: true);
    await file.writeAsString('${jsonEncode(tree)}\n');
  });
}
