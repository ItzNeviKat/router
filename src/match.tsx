import React, {
  Children,
  cloneElement,
  createContext,
  FC,
  isValidElement,
  ReactNode,
  useEffect,
  useMemo,
  useState
} from 'react';
import { deepForEach, deepMap } from 'react-children-utilities';
import { Action, Listener, Update } from 'history';
import {
  ViewProps,
  View as VKUIView,
  Root as VKUIRoot,
  Epic as VKUIEpic
} from '@vkontakte/vkui';

import { NODE_ID_ATTRIBUTE } from './constants';
import { View, Root, Epic } from './components';
import { AnyDict, StringDict } from './types';
import { deserialize } from './utils/deserialize';
import { getNavID, getNodeID } from './utils/node';
import {
  createNav,
  Nav,
  NavNodeID,
  NavTransitionID,
  NavType
} from './utils/navs';
import { detectStyle } from './utils/style';
import { history } from './utils/history';

function createNodeID(node: ReactNode): string {
  let key: string = '';

  deepForEach(node, (node) => {
    if (isValidElement(node)) key += node.key;
  });

  return key;
}

function markNodeIDs(root: ReactNode): ReactNode {
  return deepMap(root, (node: ReactNode) => {
    if (!isValidElement(node)) return node;

    let navID: string | undefined = getNavID(node);

    // mark only VKUI elements
    if (!navID) {
      switch (node.type) {
        case View:
        case Root:
        case Epic:
          console.warn(
            '[router] found known navigation layout but no `nav` property. Maybe you forgot about it?'
          );
          break;

        case VKUIView:
        case VKUIRoot:
        case VKUIEpic:
          console.warn(
            '[router] use View, Root and Epic imported from the router to work correctly.'
          );
          break;
      }

      return node;
    }

    return cloneElement(node, {
      ...node.props,
      [NODE_ID_ATTRIBUTE]: createNodeID(node)
    });
  })[0];
}

function extractLayoutsAsNavs(root: ReactNode): Nav[] {
  let items: Nav[] = [];

  deepForEach(root, (node: ReactNode) => {
    if (!isValidElement(node)) return;

    let navID: string | undefined = getNavID(node);
    if (!navID) return node;

    let type: NavType;
    switch (node.type) {
      case View:
        type = 'view';
        break;

      case Root:
        type = 'root';
        break;

      case Epic:
        type = 'epic';
        break;

      default:
        return node;
    }

    let availableTransitionIDs: NavTransitionID[] = Children.toArray(
      node.props.children
    )
      .map((child) => isValidElement(child) && getNavID(child.props))
      .filter((child) => child) as NavTransitionID[];
    let nodeID: NavNodeID = node.props[NODE_ID_ATTRIBUTE];

    items.unshift(createNav(type, navID, availableTransitionIDs, nodeID));
  });

  return items;
}

function renderRoute(
  root: ReactNode,
  navs: Nav[],
  config: Omit<MatchConfig, 'plugins'>
): ReactNode {
  let { pathname } = history.location;

  let deserialized: StringDict = deserialize(root, pathname);

  return deepMap(root, (node: ReactNode) => {
    if (!isValidElement(node)) return node;

    let nodeID: string | undefined = getNodeID(node);
    if (!nodeID) return node;

    let value: string = deserialized[nodeID] ?? '/';
    let props: AnyDict = {
      ...node.props
    };

    switch (node.type) {
      case View:
        props.activePanel = value;

        // swipeback on mobile
        if (config.style === Style.MOBILE) {
          let nav: Nav = navs.find((nav) => nav.nodeID === nodeID)!;

          (props as ViewProps).history = nav.transitions;
          (props as ViewProps).onSwipeBack = history.back;
        }

        break;

      case Root:
        props.activeView = value;
        break;

      case Epic:
        props.activeStory = value;
        break;

      default:
        return node;
    }

    return cloneElement(node, props);
  })[0];
}

function renderCSS() {
  return (
    <style>{`
      .vkuiView__popout:empty,
      .vkuiPopoutRoot__popout:empty,
      .vkuiPopoutRoot--absolute:empty {
        display: none;
      }
    `}</style>
  );
}

export type MatchContextValue = MatchConfig & {
  root: ReactNode;
  navs: Nav[];

  // required
  style: Style;
};

/**
 * Контекст с конфигом компонента Match и внутренними значениями роутера
 */
export const MatchContext = createContext<MatchContextValue>(
  {} as MatchContextValue
);

/**
 * Стиль навигации
 */
export enum Style {
  MOBILE = 'MOBILE',
  DESKTOP = 'DESKTOP'
}

/**
 * Конфиг для компонента Match
 */
export type MatchConfig = {
  /**
   * Стиль навигации
   */
  style?: Style;

  /**
   * Начальная страница.
   * Если не указан, то при запуске не будет совершён переход
   */
  initialURL?: string;

  /**
   * Страница 404.
   * Будет использована, если страница при переходе не найдена
   */
  fallbackURL?: string;
};

/**
 * Главный компонент роутера, в него оборачивается вся структура
 */
export const Match: FC<MatchConfig> = ({ children, ...config }) => {
  let rerender = useState<unknown>()[1];

  let root: ReactNode = useMemo(() => markNodeIDs(children), [children]);
  let navs: Nav[] = useMemo(() => extractLayoutsAsNavs(root), []);

  // set or detect style
  config.style =
    config.style ?? useMemo(() => detectStyle(), [document.body.clientWidth]);

  // listen events and rerender
  useEffect(() => {
    let listener: Listener = ({ location: { pathname }, action }: Update) => {
      let deserialized: StringDict = deserialize(root, pathname);
      let keys: string[] = Object.keys(deserialized);

      // not found
      if (keys.length === 0) {
        console.warn('[router] route not found.');

        if (config.fallbackURL) history.replace(config.fallbackURL);

        return;
      }

      navs.forEach(({ nodeID, transitions }) => {
        let activeNavID: string = deserialized[nodeID] ?? '/';
        if (transitions[transitions.length - 1] === activeNavID) return;

        if (action === Action.Push) transitions.push(activeNavID);
        if (action === Action.Replace) transitions.splice(-1, 1, activeNavID);

        if (action === Action.Pop) {
          // TODO: back and forward for delta < -1 and delta > 1
          let back: boolean = transitions.includes(activeNavID);

          if (back) {
            // back
            transitions.pop();
          } else {
            // forward
            transitions.push(activeNavID);
          }
        }
      });

      rerender({});
    };

    let unlisten: VoidFunction = history.listen(listener);

    if (config.initialURL) history.replace(config.initialURL);
    else if (history.location.pathname !== '/') {
      // manually trigger listener
      listener({
        action: Action.Replace,
        location: history.location
      } as Update);
    }

    // history.listen returns unlisten function
    return unlisten;
  }, []);

  // provider for match context
  return (
    <MatchContext.Provider
      value={
        {
          root,
          navs,
          ...config
        } as MatchContextValue
      }
    >
      {/* render css */}
      {renderCSS()}

      {/* render current route */}
      {renderRoute(root, navs, config)}
    </MatchContext.Provider>
  );
};
