import $ from 'jquery';

import {Client, Request, paramsToQueryArgs} from 'app/api';
import GroupActions from 'app/actions/groupActions';
import {PROJECT_MOVED} from 'app/constants/apiErrorCodes';

jest.unmock('app/api');

describe('api', function() {
  let api;

  beforeEach(function() {
    api = new Client();
  });

  describe('paramsToQueryArgs()', function() {
    it('should convert itemIds properties to id array', function() {
      expect(
        paramsToQueryArgs({
          itemIds: [1, 2, 3],
          query: 'is:unresolved', // itemIds takes precedence
        })
      ).toEqual({id: [1, 2, 3]});
    });

    it('should extract query property if no itemIds', function() {
      expect(
        paramsToQueryArgs({
          query: 'is:unresolved',
          foo: 'bar',
        })
      ).toEqual({query: 'is:unresolved'});
    });

    it('should convert params w/o itemIds or query to undefined', function() {
      expect(
        paramsToQueryArgs({
          foo: 'bar',
          bar: 'baz', // paramsToQueryArgs ignores these
        })
      ).toBeUndefined();
    });

    it('should keep environment when query is provided', function() {
      expect(
        paramsToQueryArgs({
          query: 'is:unresolved',
          environment: 'production',
        })
      ).toEqual({query: 'is:unresolved', environment: 'production'});
    });

    it('should exclude environment when it is null/undefined', function() {
      expect(
        paramsToQueryArgs({
          query: 'is:unresolved',
          environment: null,
        })
      ).toEqual({query: 'is:unresolved'});
    });
  });

  describe('Client', function() {
    beforeEach(function() {
      jest.spyOn($, 'ajax');
    });

    describe('cancel()', function() {
      it('should abort any open XHR requests', function() {
        const req1 = new Request({
          abort: jest.fn(),
        });
        const req2 = new Request({
          abort: jest.fn(),
        });

        api.activeRequests = {
          1: req1,
          2: req2,
        };

        api.clear();

        expect(req1.xhr.abort).toHaveBeenCalledTimes(1);
        expect(req2.xhr.abort).toHaveBeenCalledTimes(1);
      });
    });
  });

  it('does not call success callback if 302 was returned because of a project slug change', function() {
    const successCb = jest.fn();
    api.activeRequests = {id: {alive: true}};
    api.wrapCallback('id', successCb)({
      responseJSON: {
        detail: {
          code: PROJECT_MOVED,
          message: '...',
          extra: {
            slug: 'new-slug',
          },
        },
      },
    });
    expect(successCb).not.toHaveBeenCalled();
  });

  it('handles error callback', function() {
    jest.spyOn(api, 'wrapCallback').mockImplementation((id, func) => func);
    const errorCb = jest.fn();
    const args = ['test', true, 1];
    api.handleRequestError(
      {
        id: 'test',
        path: 'test',
        requestOptions: {error: errorCb},
      },
      ...args
    );

    expect(errorCb).toHaveBeenCalledWith(...args);
  });

  it('handles undefined error callback', function() {
    expect(() =>
      api.handleRequestError(
        {
          id: 'test',
          path: 'test',
          requestOptions: {},
        },
        {},
        {}
      )
    ).not.toThrow();
  });

  describe('bulkUpdate()', function() {
    beforeEach(function() {
      jest.spyOn(api, '_wrapRequest');
      jest.spyOn(GroupActions, 'update'); // stub GroupActions.update call from api.update
    });

    it('should use itemIds as query if provided', function() {
      api.bulkUpdate({
        orgId: '1337',
        projectId: '1337',
        itemIds: [1, 2, 3],
        data: {status: 'unresolved'},
        query: 'is:resolved',
      });

      expect(api._wrapRequest).toHaveBeenCalledTimes(1);
      expect(api._wrapRequest).toHaveBeenCalledWith(
        '/projects/1337/1337/issues/',
        expect.objectContaining({query: {id: [1, 2, 3]}}),
        undefined
      );
    });

    it('should use query as query if itemIds are absent', function() {
      api.bulkUpdate({
        orgId: '1337',
        projectId: '1337',
        itemIds: null,
        data: {status: 'unresolved'},
        query: 'is:resolved',
      });

      expect(api._wrapRequest).toHaveBeenCalledTimes(1);
      expect(api._wrapRequest).toHaveBeenCalledWith(
        '/projects/1337/1337/issues/',
        expect.objectContaining({query: {query: 'is:resolved'}}),
        undefined
      );
    });
  });

  describe('merge()', function() {
    // TODO: this is totally copypasta from the test above. We need to refactor
    //       these API methods/tests.
    beforeEach(function() {
      jest.spyOn(api, '_wrapRequest');
      jest.spyOn(GroupActions, 'merge'); // stub GroupActions.merge call from api.merge
    });

    it('should use itemIds as query if provided', function() {
      api.merge({
        orgId: '1337',
        projectId: '1337',
        itemIds: [1, 2, 3],
        data: {status: 'unresolved'},
        query: 'is:resolved',
      });

      expect(api._wrapRequest).toHaveBeenCalledTimes(1);
      expect(api._wrapRequest).toHaveBeenCalledWith(
        '/projects/1337/1337/issues/',
        expect.objectContaining({query: {id: [1, 2, 3]}}),
        undefined
      );
    });

    it('should use query as query if itemIds are absent', function() {
      api.merge({
        orgId: '1337',
        projectId: '1337',
        itemIds: null,
        data: {status: 'unresolved'},
        query: 'is:resolved',
      });

      expect(api._wrapRequest).toHaveBeenCalledTimes(1);
      expect(api._wrapRequest).toHaveBeenCalledWith(
        '/projects/1337/1337/issues/',
        expect.objectContaining({query: {query: 'is:resolved'}}),
        undefined
      );
    });
  });
});
