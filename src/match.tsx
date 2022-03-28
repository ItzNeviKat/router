import React, {
  Children,
  cloneElement,
  createContext,
  FC,
  isValidElement,
  ReactElement,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { deepForEach, deepMap } from 'react-children-utilities';
import { Action, Listener, Update, createPath } from 'history';
import {
  ViewProps,
  View as VKUIView,
  Root as VKUIRoot,
  Epic as VKUIEpic
} from '@vkontakte/vkui';

import { NODE_ID_ATTRIBUTE } from './constants';
import { View, Root, Epic } from './components';
import { useStyle } from './hooks';
import { AnyDict, FallbackMeta, StringDict } from './types';
import { deserialize } from './utils/deserialize';
import { getNavID, getNodeID } from './utils/node';
import {
  createNav,
  Nav,
  NavNodeID,
  NavTransitionID,
  NavType
} from './utils/navs';
import { history, State } from './utils/history';
import { setLocation } from './utils/bridge';

function createNodeID(node: ReactNode): string {
  let key: string = '';

  deepForEach(node, (node) => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (isValidElement(node)) key += node.key ?? node.type.name;
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
  route: string,
  root: ReactNode,
  navs: Nav[],
  config: Omit<MatchConfig, 'plugins'>
): ReactNode {
  let deserialized: StringDict = deserialize(root, route);

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

export type MatchContextValue = MatchConfig & {
  /**
   * Промаркированные дети
   */
  root: ReactNode;

  /**
   * Слои навигации
   */
  navs: Nav[];

  /**
   * Стиль навигации
   */
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
   * Стиль навигации.
   * По умолчанию берётся платформа, прокинутая через ConfigProvider
   */
  style?: Style;

  /**
   * Начальная страница.
   * Если не указана, то при запуске не будет совершён переход
   */
  initialURL?: string;

  /**
   * Страница 404.
   * Будет использована, если страница при переходе не найдена
   */
  fallbackURL?: string;

  /**
   * Отключает отправку события VKWebAppSetLocation для установки хэша вне фрейма.
   * По умолчанию выключено, событие отправляется
   */
  disableSetLocation?: boolean;
};

/**
 * Главный компонент роутера, в него оборачивается вся структура
 */
export const Match: FC<MatchConfig> = ({ children, ...config }) => {
  let rerender = useState<unknown>()[1];
  let frender = useRef(true);

  let root: ReactNode = useMemo(() => markNodeIDs(children), [children]);
  let navs: Nav[] = useMemo(() => extractLayoutsAsNavs(root), []);

  let route: string = frender.current
    ? config.initialURL ?? history.location.pathname
    : history.location.pathname;

  // set or detect style
  config.style = config.style ?? useStyle();

  // listen events and rerender
  useEffect(() => {
    let listener: Listener = ({ location, action }: Update) => {
      let state: State<any> | undefined = location.state as
        | State<any>
        | undefined;
      let deserialized: StringDict = deserialize(root, location.pathname);
      let keys: string[] = Object.keys(deserialized);

      // not found
      if (keys.length === 0) {
        console.warn('[router] route not found.');

        if (config.fallbackURL)
          return history.replace(config.fallbackURL, {
            forcePush: true,
            meta: {
              from: createPath(location),
              meta: state?.meta
            }
          } as State<FallbackMeta<any>>);
      }

      if (state?.forcePush) action = Action.Push;

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

      // set parent page location hash with vk bridge
      if (!config.disableSetLocation) setLocation(location);

      rerender({});
    };

    let unlisten: VoidFunction = history.listen(listener);

    if (config.initialURL) {
      route = config.initialURL;
      history.replace(config.initialURL);
    } else if (history.location.pathname !== '/') {
      let nextURL: string = createPath(history.location);

      history.replace('/');
      history.push(nextURL);
    }

    // set is first render to false
    frender.current = false;

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
      {/* render current route */}
      {renderRoute(route, root, navs, config)}
    </MatchContext.Provider>
  );
};

/**
 * Получение активного попаута по nav/id свойству
 * @param popout имя активного попаута
 * @param elements возможные попауты
 * @returns активный попаут
 */
export function matchPopout(
  popout: string | null,
  elements: ReactElement[]
): ReactElement | null {
  return popout
    ? elements.find((node) => getNavID(node) === popout) ?? null
    : null;
}
