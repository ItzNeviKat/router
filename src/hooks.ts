import {
  MouseEvent,
  MouseEventHandler,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react';
import { Action, Location, Update } from 'history';
import { Platform, ConfigProviderContext } from '@vkontakte/vkui';

import { AnyDict, StringDict } from './types';
import { MatchContext, Style } from './match';
import { history, State } from './utils/history';
import { deserialize } from './utils/deserialize';
import { NavNodeID, NavTransitionID } from './utils/navs';

function getParams<T>(): T {
  return (Object.fromEntries(
    new URLSearchParams(
      history.location.search.slice(1)
    ) as unknown as Iterable<any>
  ) ?? {}) as T;
}

/**
 * Хук для получения параметров
 */
export function useParams<T extends StringDict>(): T {
  let [params, setParams] = useState<StringDict>(getParams);

  useEffect(() => {
    return history.listen(() => setParams(getParams));
  }, []);

  return params as T;
}

function getMeta<T>(): T {
  return ((history.location.state as State<T>)?.meta ?? {}) as T;
}

/**
 * Хук для получения метаданных
 */
export function useMeta<T extends AnyDict>(): T {
  let [meta, setMeta] = useState<AnyDict>(getMeta);

  useEffect(() => {
    return history.listen(({ action }: Update) => {
      if ([Action.Push, Action.Replace].includes(action)) setMeta(getMeta);
    });
  }, []);

  return meta as T;
}

function getLocation(): Location {
  return history.location;
}

/**
 * Хук для получения текущей локации
 */
export function useLocation(): Location {
  let [location, setLocation] = useState<Location>(getLocation);

  useEffect(() => {
    return history.listen(() => setLocation(getLocation));
  }, []);

  return location;
}

let initialLocation: globalThis.Location = location;

/**
 * Хук для получения начальной локации при запуске
 */
export function useInitialLocation(): globalThis.Location {
  return initialLocation;
}

/**
 * Хук для получения активных свойств слоёв навигации
 */
export function useDeserialized(): Record<'view' | 'panel' | string, string> {
  let { root, navs } = useContext(MatchContext);

  let deserialized: StringDict = useMemo(
    () => deserialize(root, history.location.pathname),
    [root, history.location.pathname]
  );

  let { view, panel } = useMemo(() => {
    let rootNodeID: NavNodeID =
      navs.find(({ type }) => type === 'root' || type === 'epic')?.nodeID ??
      '/';
    let view: NavTransitionID = deserialized[rootNodeID] ?? '/';

    let viewNodeID: NavNodeID =
      navs.find(({ type, navID }) => type === 'view' && navID === view)
        ?.nodeID ?? '/';
    let panel: NavTransitionID = deserialized[viewNodeID] ?? '/';

    return { view, panel };
  }, [root, navs, history.location.pathname]);

  return {
    ...deserialized,
    view,
    panel
  };
}

let actionRef: Element | null = null;

/**
 * Хук для удобной работы с рефами при использовании ActionSheet
 * @param handler обработчик при установке рефа, в нём нужно делать переход к ActionSheet. Не используется в самом ActionSheet при получении рефа
 */
export function useActionRef(handler?: (e: Element | null) => void) {
  let setActionRef = useCallback(
    (el: Element | null) => {
      actionRef = el;
      if (handler) handler(actionRef);
    },
    [handler]
  );

  let setActionRefHandler: MouseEventHandler<HTMLElement> = useCallback(
    (e: MouseEvent<HTMLElement> | undefined) => {
      actionRef = e?.target as Element;
      if (handler) handler(actionRef);
    },
    [handler]
  );

  return { actionRef, setActionRef, setActionRefHandler };
}

/**
 * Хук для получения текущего стиля навигации
 */
export function useStyle(): Style {
  let { platform } = useContext(ConfigProviderContext);

  return platform === Platform.VKCOM ? Style.DESKTOP : Style.MOBILE;
}
